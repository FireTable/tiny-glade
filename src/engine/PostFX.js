import * as THREE from 'three';

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Pass 2A: Screen-Space Horizon/Ground-Truth Ambient Occlusion (GTAO) with strict thickness halo rejection
const GTAO_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform vec2 uInvFocalLen; // (1 / P[0][0], 1 / P[1][1])
uniform float uAoRadius;
uniform float uAoIntensity;
uniform int uDirs;
uniform int uSteps;

varying vec2 vUv;

float getLinearDepth(float rawDepth) {
  float zNdc = rawDepth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - zNdc * (uFar - uNear));
}

vec3 getViewPos(vec2 uv, float rawDepth) {
  float linZ = getLinearDepth(rawDepth);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uInvFocalLen * linZ, -linZ);
}

float ignNoise(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

void main() {
  float centerRaw = texture2D(tDepth, vUv).r;
  if (centerRaw >= 0.9998) {
    gl_FragColor = vec4(1.0);
    return;
  }

  vec3 P = getViewPos(vUv, centerRaw);
  float viewDist = -P.z;
  if (viewDist > 115.0) {
    gl_FragColor = vec4(1.0);
    return;
  }

  // Min-derivative view normal reconstruction to avoid silhouette edge artifacts
  vec2 texel = 1.0 / uResolution;
  float rL = texture2D(tDepth, vUv - vec2(texel.x, 0.0)).r;
  float rR = texture2D(tDepth, vUv + vec2(texel.x, 0.0)).r;
  float rD = texture2D(tDepth, vUv - vec2(0.0, texel.y)).r;
  float rU = texture2D(tDepth, vUv + vec2(0.0, texel.y)).r;

  vec3 pL = getViewPos(vUv - vec2(texel.x, 0.0), rL);
  vec3 pR = getViewPos(vUv + vec2(texel.x, 0.0), rR);
  vec3 pD = getViewPos(vUv - vec2(0.0, texel.y), rD);
  vec3 pU = getViewPos(vUv + vec2(0.0, texel.y), rU);

  vec3 dPdx = (abs(pR.z - P.z) < abs(P.z - pL.z)) ? (pR - P) : (P - pL);
  vec3 dPdy = (abs(pU.z - P.z) < abs(P.z - pD.z)) ? (pU - P) : (P - pD);
  vec3 crossVec = cross(dPdx, dPdy);
  float crossLen = length(crossVec);
  if (crossLen < 1e-7) {
    gl_FragColor = vec4(1.0);
    return;
  }
  vec3 N = crossVec / crossLen;

  // Screen-projected search radius clamped strictly to prevent close-up overshoot
  float projScale = 1.0 / max(uInvFocalLen.y * viewDist, 0.25);
  float screenRadius = clamp(uAoRadius * projScale * 0.5, 0.0025, 0.048);

  float noise = ignNoise(gl_FragCoord.xy);
  float baseAngle = noise * 6.2831853;
  float radialJitter = fract(noise * 7.31 + 0.25);

  float occSum = 0.0;
  float sampleCount = 0.0;
  float aspect = uResolution.x / max(uResolution.y, 1.0);

  for (int d = 0; d < 4; d++) {
    if (d >= uDirs) break;
    float phi = baseAngle + (float(d) / float(uDirs)) * 6.2831853;
    vec2 dirUv = vec2(cos(phi) / aspect, sin(phi));

    float dirBestOcc = 0.0;
    for (int s = 0; s < 3; s++) {
      if (s >= uSteps) break;
      float t = (float(s) + 0.35 + radialJitter * 0.65) / float(uSteps);
      vec2 sUv = vUv + dirUv * (screenRadius * t);
      if (sUv.x < 0.001 || sUv.x > 0.999 || sUv.y < 0.001 || sUv.y > 0.999) continue;

      float sRaw = texture2D(tDepth, sUv).r;
      if (sRaw >= 0.9998) continue; // Sky never occludes

      vec3 S = getViewPos(sUv, sRaw);
      vec3 diff = S - P;
      float dist = length(diff);
      float depthGap = abs(S.z - P.z);

      // Strict thin-object halo rejection: background behind foreground edge contributes ZERO AO
      float rangeWeight =
        smoothstep(uAoRadius * 1.05, uAoRadius * 0.18, dist) *
        smoothstep(uAoRadius * 0.85, uAoRadius * 0.12, depthGap);

      if (rangeWeight > 0.001 && dist > 0.004) {
        float horizonCos = dot(N, diff / dist);
        float occ = clamp((horizonCos - 0.08) / 0.92, 0.0, 1.0) * rangeWeight;
        dirBestOcc = max(dirBestOcc, occ);
      }
    }
    occSum += dirBestOcc;
    sampleCount += 1.0;
  }

  float rawOcc = (sampleCount > 0.0) ? (occSum / sampleCount) : 0.0;
  float distFade = 1.0 - smoothstep(58.0, 105.0, viewDist);
  float ao = clamp(1.0 - rawOcc * uAoIntensity * distFade, 0.28, 1.0);

  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

// Pass 2B: Depth-Aware Edge-Stopping Bilateral Blur for silky crevice AO with razor-sharp edges
const BILATERAL_BLUR_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uTexelSize;
uniform float uNear;
uniform float uFar;

varying vec2 vUv;

float getLinearDepth(float rawDepth) {
  float zNdc = rawDepth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - zNdc * (uFar - uNear));
}

void main() {
  float cRaw = texture2D(tDepth, vUv).r;
  if (cRaw >= 0.9998) {
    gl_FragColor = vec4(1.0);
    return;
  }

  float cDepth = getLinearDepth(cRaw);
  float sumAo = 0.0;
  float sumW = 0.0;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y)) * uTexelSize;
      vec2 sUv = vUv + offset;
      float sRaw = texture2D(tDepth, sUv).r;
      if (sRaw >= 0.9998) continue;

      float sDepth = getLinearDepth(sRaw);
      float spatialW = exp(-float(x * x + y * y) * 0.32);
      float depthW = exp(-abs(sDepth - cDepth) * 6.5);
      float w = spatialW * depthW;

      sumAo += texture2D(tAo, sUv).r * w;
      sumW += w;
    }
  }

  float ao = sumW > 1e-4 ? (sumAo / sumW) : texture2D(tAo, vUv).r;
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

// Pass 3A: Half-Res Screen-Space Volumetric Sun Shafts (God Rays)
const GODRAYS_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tDepth;
uniform vec2 uSunScreenUv;
uniform float uShaftWeight;

varying vec2 vUv;

float ignNoise(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

void main() {
  if (uShaftWeight <= 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 delta = (uSunScreenUv - vUv);
  float distToSun = length(delta);
  // Clamp radial march length so off-center sun shafts stay smooth & artifact-free
  vec2 stepUv = (delta / max(distToSun, 1e-4)) * min(distToSun, 0.55) / 16.0;

  float jitter = ignNoise(gl_FragCoord.xy);
  vec2 curUv = vUv + stepUv * jitter;

  float illumination = 0.0;
  float decay = 1.0;

  for (int i = 0; i < 16; i++) {
    if (curUv.x >= 0.0 && curUv.x <= 1.0 && curUv.y >= 0.0 && curUv.y <= 1.0) {
      float d = texture2D(tDepth, curUv).r;
      float isSky = step(0.9995, d);
      float sunProx = exp(-length(curUv - uSunScreenUv) * 2.8);
      illumination += isSky * sunProx * decay;
    }
    curUv += stepUv;
    decay *= 0.935;
  }

  float shaft = (illumination / 16.0) * uShaftWeight;
  gl_FragColor = vec4(shaft, shaft, shaft, 1.0);
}
`;

// Pass 4A: Multi-Mip HDR Bloom Downsample (with soft-knee prefilter + firefly clamp on mip 0)
const BLOOM_DOWNSAMPLE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tInput;
uniform vec2 uTexelSize;
uniform float uIsFirstMip;
uniform float uThreshold;
uniform float uKnee;

varying vec2 vUv;

vec3 prefilterHDR(vec3 c) {
  // Clamp extreme subpixel specular fireflies
  c = min(c, vec3(9.0));
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = (rq * rq) / max(4.0 * uKnee, 1e-4);
  float weight = max(rq, br - uThreshold) / max(br, 1e-4);
  return c * max(weight, 0.0);
}

void main() {
  vec2 d = uTexelSize;
  vec3 c0 = texture2D(tInput, vUv).rgb;
  vec3 c1 = texture2D(tInput, vUv + vec2(-d.x, -d.y)).rgb;
  vec3 c2 = texture2D(tInput, vUv + vec2( d.x, -d.y)).rgb;
  vec3 c3 = texture2D(tInput, vUv + vec2(-d.x,  d.y)).rgb;
  vec3 c4 = texture2D(tInput, vUv + vec2( d.x,  d.y)).rgb;

  vec3 c5 = texture2D(tInput, vUv + vec2(-2.0 * d.x, 0.0)).rgb;
  vec3 c6 = texture2D(tInput, vUv + vec2( 2.0 * d.x, 0.0)).rgb;
  vec3 c7 = texture2D(tInput, vUv + vec2(0.0, -2.0 * d.y)).rgb;
  vec3 c8 = texture2D(tInput, vUv + vec2(0.0,  2.0 * d.y)).rgb;

  if (uIsFirstMip > 0.5) {
    c0 = prefilterHDR(c0);
    c1 = prefilterHDR(c1);
    c2 = prefilterHDR(c2);
    c3 = prefilterHDR(c3);
    c4 = prefilterHDR(c4);
    c5 = prefilterHDR(c5);
    c6 = prefilterHDR(c6);
    c7 = prefilterHDR(c7);
    c8 = prefilterHDR(c8);
  }

  vec3 avg = c0 * 0.25 + (c1 + c2 + c3 + c4) * 0.125 + (c5 + c6 + c7 + c8) * 0.0625;
  gl_FragColor = vec4(avg, 1.0);
}
`;

// Pass 4B: Multi-Mip HDR Bloom Tent Upsample
const BLOOM_UPSAMPLE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tLowMip;
uniform sampler2D tHighMip;
uniform vec2 uTexelSize;
uniform float uScatter;

varying vec2 vUv;

void main() {
  vec2 d = uTexelSize * 1.15;
  vec3 s = vec3(0.0);
  s += texture2D(tLowMip, vUv + vec2(-d.x, -d.y)).rgb * 1.0;
  s += texture2D(tLowMip, vUv + vec2( 0.0, -d.y)).rgb * 2.0;
  s += texture2D(tLowMip, vUv + vec2( d.x, -d.y)).rgb * 1.0;
  s += texture2D(tLowMip, vUv + vec2(-d.x,  0.0)).rgb * 2.0;
  s += texture2D(tLowMip, vUv).rgb * 4.0;
  s += texture2D(tLowMip, vUv + vec2( d.x,  0.0)).rgb * 2.0;
  s += texture2D(tLowMip, vUv + vec2(-d.x,  d.y)).rgb * 1.0;
  s += texture2D(tLowMip, vUv + vec2( 0.0,  d.y)).rgb * 2.0;
  s += texture2D(tLowMip, vUv + vec2( d.x,  d.y)).rgb * 1.0;
  s /= 16.0;

  vec3 hi = texture2D(tHighMip, vUv).rgb;
  gl_FragColor = vec4(mix(hi, hi + s, uScatter), 1.0);
}
`;

// Pass 5A: Combine HDR Scene + Warm-Bounce GTAO + World-Space Valley Mist + Volumetric Shafts + Bloom + CoC
const PRE_DOF_COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAo;
uniform sampler2D tGodRays;
uniform sampler2D tBloom;

uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform float uNear;
uniform float uFar;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uSkyZenithColor;
uniform float uNightFactor;
uniform float uTwilightFactor;
uniform float uMistDensity;
uniform float uWaterLevel;
uniform float uElapsed;

uniform float uBloomStrength;
uniform float uDofEnabled;
uniform float uFocusDistance;
uniform float uAperture;
uniform float uTiltShiftAmount;

varying vec2 vUv;

float getLinearDepth(float rawDepth) {
  float zNdc = rawDepth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - zNdc * (uFar - uNear));
}

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb;
  float rawDepth = texture2D(tDepth, vUv).r;
  bool isSky = rawDepth >= 0.9998;
  float linDepth = isSky ? uFar : getLinearDepth(rawDepth);

  // 1. Apply GTAO with subtle warm multi-bounce tint (protects bright sunlit highlights & emissives)
  if (!isSky) {
    float ao = texture2D(tAo, vUv).r;
    float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    float directProtect = smoothstep(0.95, 2.4, lum);
    float effAo = mix(ao, 1.0, directProtect * 0.78);
    // Warm bounce inside limestone/terracotta crevices instead of cold grey dirt
    vec3 coloredAo = pow(vec3(effAo), vec3(0.95, 1.03, 1.12));
    hdr *= coloredAo;
  }

  // 2. Reconstruct World Position for Valley Height Mist & Atmospheric Aerial Perspective
  vec4 clip = vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 worldH = uInvViewProj * clip;
  vec3 worldPos = worldH.xyz / max(worldH.w, 1e-6);

  vec3 rayVec = worldPos - uCameraPos;
  float fullDist = length(rayVec);
  vec3 rayDir = rayVec / max(fullDist, 1e-4);

  if (uMistDensity > 0.005) {
    float cosSun = dot(rayDir, uSunDirection);
    float mieScatter = pow(clamp(cosSun * 0.5 + 0.5, 0.0, 1.0), 4.0) * (1.0 - uNightFactor);

    vec3 dayMistTint = mix(
      mix(uSkyHorizonColor, uSkyZenithColor, 0.22),
      uSunColor * 1.08,
      0.32 + mieScatter * 0.52 + uTwilightFactor * 0.22
    );
    vec3 nightMistTint = vec3(0.08, 0.13, 0.24) + vec3(0.05, 0.08, 0.14) * max(rayDir.y + 0.3, 0.0);
    vec3 mistColor = mix(dayMistTint, nightMistTint, uNightFactor);

    float mistFactor = 0.0;
    if (!isSky) {
      float marchDist = min(fullDist, 130.0);
      float hBase = uWaterLevel - 0.15;
      float invScaleH = 1.0 / 3.1;
      float y0 = max(uCameraPos.y - hBase, 0.0);
      float y1 = max(worldPos.y - hBase, 0.0);
      float d0 = exp(-y0 * invScaleH);
      float d1 = exp(-y1 * invScaleH);
      float dy = y1 - y0;
      float avgHeightDensity = (abs(dy) > 0.05)
        ? (d0 - d1) / (dy * invScaleH)
        : 0.5 * (d0 + d1);

      // Gentle animated mist drift pooling in pond basins & low valleys
      float drift = 0.80 + 0.20 * sin(worldPos.x * 0.09 + uElapsed * 0.18) * cos(worldPos.z * 0.08 - uElapsed * 0.14);
      float opticalDepth = marchDist * avgHeightDensity * drift * uMistDensity * 0.026;
      // Add subtle distant aerial haze past 45m
      opticalDepth += max(marchDist - 42.0, 0.0) * uMistDensity * 0.0028;
      mistFactor = clamp(1.0 - exp(-opticalDepth), 0.0, 0.76);
    } else {
      // Subtle low-skirt blend only below distant hill horizon so clouds, moon & stars stay crisp
      float horizonGrazing = smoothstep(-0.04, -0.16, rayDir.y);
      mistFactor = horizonGrazing * uMistDensity * 0.22;
    }

    hdr = mix(hdr, mistColor, mistFactor);
  }

  // 3. Add Volumetric Sun Shafts (God Rays)
  float godRay = texture2D(tGodRays, vUv).r;
  hdr += uSunColor * godRay * 0.58 * (1.0 - uNightFactor);

  // 4. Add Multi-Mip HDR Bloom
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  hdr += bloom * uBloomStrength;

  // 5. Compute Miniature Diorama Circle-of-Confusion (CoC) in [0, 1]
  // Keep sky (stars, moon, sun, clouds) at coc = 0.0 so celestial details remain razor-sharp!
  float coc = 0.0;
  if (!isSky && uDofEnabled > 0.5 && uAperture > 0.005) {
    float focalDist = max(uFocusDistance, 2.0);
    float relDefocus = abs(linDepth - focalDist) / focalDist;
    // Smooth wide sharp sweet-spot around focus so entire central cottage/keep stays tack-sharp
    float lensCoc = smoothstep(0.24, 1.55, relDefocus) * uAperture;
    float edgeDist = abs(vUv.y - 0.5);
    float tiltCoc = smoothstep(0.34, 0.52, edgeDist) * uAperture * uTiltShiftAmount;
    coc = clamp(max(lensCoc, tiltCoc), 0.0, 1.0);
  }

  gl_FragColor = vec4(max(hdr, vec3(0.0)), coc);
}
`;

// Pass 5B: Vogel-Disk Bokeh DoF + Contrast-Adaptive Sharpening + AgX/ACES Filmic Tone Mapping + Grading + Dither
const FINAL_DISPLAY_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tPreDof;
uniform vec2 uResolution;
uniform float uDofEnabled;
uniform float uNightFactor;
uniform float uExposure;

varying vec2 vUv;

float ignNoise(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

// AgX-inspired Filmic Tone Mapping with creamy highlight desaturation & rich night shadow preservation
vec3 toneMapTinyGlade(vec3 color) {
  color *= uExposure;

  // Gentle inset matrix (AgX-style chroma compression in bright highlights so amber lanterns & sun never clip to harsh neon)
  mat3 inset = mat3(
    0.86, 0.07, 0.07,
    0.06, 0.88, 0.06,
    0.05, 0.07, 0.88
  );
  vec3 c = inset * max(color, vec3(0.0));

  // Filmic rational S-curve (Narkowicz/Hable tuned with gentle toe so shadows stay detailed)
  const float a = 2.42;
  const float b = 0.042;
  const float d = 2.35;
  const float e = 0.56;
  const float f = 0.14;
  c = clamp((c * (a * c + b)) / (c * (d * c + e) + f), 0.0, 1.0);

  // Subtle outset matrix to restore lush meadow greens, terracotta reds, and cerulean skies
  mat3 outset = mat3(
     1.14, -0.07, -0.07,
    -0.06,  1.13, -0.07,
    -0.05, -0.07,  1.12
  );
  c = clamp(outset * c, 0.0, 1.0);

  // Perceptual Tiny Glade color grading: warm sunlit highlights, velvety azure-tinted shadows
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowLift = mix(vec3(0.98, 0.995, 1.025), vec3(0.96, 0.99, 1.05), uNightFactor);
  vec3 highlightWarmth = vec3(1.018, 1.004, 0.982);
  c *= mix(shadowLift, highlightWarmth, smoothstep(0.15, 0.80, lum));

  // Linear to sRGB transfer
  vec3 srgbLo = c * 12.92;
  vec3 srgbHi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(srgbLo, srgbHi, step(vec3(0.0031308), c));
}

void main() {
  vec2 texel = 1.0 / uResolution;
  vec4 centerTap = texture2D(tPreDof, vUv);
  vec3 hdr = centerTap.rgb;
  float centerCoc = centerTap.a;

  // 1. 16-tap Golden-Angle Vogel Disk Bokeh Gather when CoC > 0
  if (uDofEnabled > 0.5 && centerCoc > 0.015) {
    float maxRadiusPx = 6.8;
    float radiusPx = centerCoc * maxRadiusPx;
    float rot = ignNoise(gl_FragCoord.xy) * 6.2831853;
    float ca = cos(rot);
    float sa = sin(rot);

    vec3 acc = hdr;
    float wSum = 1.0;

    for (int i = 0; i < 16; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 16.0);
      float theta = fi * 2.39996323; // Golden angle
      vec2 disk = vec2(cos(theta), sin(theta)) * r;
      vec2 rotDisk = vec2(ca * disk.x - sa * disk.y, sa * disk.x + ca * disk.y);
      vec2 sUv = clamp(vUv + rotDisk * texel * radiusPx, vec2(0.001), vec2(0.999));

      vec4 sTap = texture2D(tPreDof, sUv);
      // Prevent sharp foreground objects or crisp sky stars (coc == 0) from smearing into bokeh gather
      if (sTap.a < 0.004) continue;
      float w = smoothstep(0.0, 0.12, sTap.a + 0.04) * mix(0.45, 1.0, min(1.0, (sTap.a + 0.05) / (centerCoc + 0.05)));
      acc += sTap.rgb * w;
      wSum += w;
    }
    hdr = acc / wSum;
  } else {
    // 2. Contrast-Adaptive Sharpening (CAS) on crisp in-focus center region
    float sharpMask = (1.0 - smoothstep(0.0, 0.18, centerCoc));
    if (sharpMask > 0.05) {
      vec3 n = texture2D(tPreDof, vUv + vec2(0.0,  texel.y)).rgb;
      vec3 s = texture2D(tPreDof, vUv + vec2(0.0, -texel.y)).rgb;
      vec3 e = texture2D(tPreDof, vUv + vec2( texel.x, 0.0)).rgb;
      vec3 w = texture2D(tPreDof, vUv + vec2(-texel.x, 0.0)).rgb;

      vec3 mn = min(hdr, min(min(n, s), min(e, w)));
      vec3 mx = max(hdr, max(max(n, s), max(e, w)));
      vec3 contrast = clamp(mn / (mx + vec3(1e-4)), 0.0, 1.0);
      vec3 peak = -0.14 * sqrt(contrast) * sharpMask;
      hdr = max((hdr + (n + s + e + w) * peak) / (1.0 + 4.0 * peak), vec3(0.0));
    }
  }

  vec3 srgb = toneMapTinyGlade(hdr);

  // 3. Triangular Blue/IGN Dither (+/- 0.5/255) to eliminate 8-bit sky & mist banding
  float n1 = ignNoise(gl_FragCoord.xy);
  float n2 = ignNoise(gl_FragCoord.xy + vec2(19.37, 47.11));
  float dither = (n1 + n2 - 1.0) / 255.0;
  srgb = clamp(srgb + dither, 0.0, 1.0);

  gl_FragColor = vec4(srgb, 1.0);
}
`;

const BLOOM_MIPS = 4;

export class PostFX {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this._quality = (opts.quality || 'high').toLowerCase();
    this._width = Math.max(1, opts.width || 1280);
    this._height = Math.max(1, opts.height || 720);

    this.dofState = {
      enabled: opts.dofEnabled ?? true,
      aperture: opts.aperture ?? 0.28,
      focusDistance: opts.focusDistance ?? 28.0,
      tiltShift: opts.tiltShift ?? 0.36,
      autoFocus: opts.autoFocus ?? true,
    };

    // Single shared fullscreen triangle (zero quad seam, zero per-frame allocations)
    this._fsGeo = new THREE.BufferGeometry();
    this._fsGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
    );
    this._fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fsScene = new THREE.Scene();
    this._fsMesh = new THREE.Mesh(this._fsGeo, null);
    this._fsMesh.frustumCulled = false;
    this._fsScene.add(this._fsMesh);

    this._initShaders();
    this._allocateTargets();

    // Scratch math objects
    this._invViewProj = new THREE.Matrix4();
    this._viewProj = new THREE.Matrix4();
    this._tmpSunClip = new THREE.Vector4();
    this._tmpCamFwd = new THREE.Vector3();
  }

  _initShaders() {
    this._gtaoMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GTAO_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tDepth: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.25 },
        uFar: { value: 480 },
        uInvFocalLen: { value: new THREE.Vector2(1, 1) },
        uAoRadius: { value: 0.68 },
        uAoIntensity: { value: 1.05 },
        uDirs: { value: 4 },
        uSteps: { value: 3 },
      },
    });

    this._bilateralMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BILATERAL_BLUR_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tAo: { value: null },
        tDepth: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.25 },
        uFar: { value: 480 },
      },
    });

    this._godRaysMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GODRAYS_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tDepth: { value: null },
        uSunScreenUv: { value: new THREE.Vector2(0.5, 0.7) },
        uShaftWeight: { value: 0.0 },
      },
    });

    this._bloomDownMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BLOOM_DOWNSAMPLE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tInput: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uIsFirstMip: { value: 1.0 },
        uThreshold: { value: 1.24 },
        uKnee: { value: 0.55 },
      },
    });

    this._bloomUpMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BLOOM_UPSAMPLE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tLowMip: { value: null },
        tHighMip: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uScatter: { value: 0.78 },
      },
    });

    this._preDofMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: PRE_DOF_COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tAo: { value: null },
        tGodRays: { value: null },
        tBloom: { value: null },
        uInvViewProj: { value: new THREE.Matrix4() },
        uCameraPos: { value: new THREE.Vector3() },
        uNear: { value: 0.25 },
        uFar: { value: 480 },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSkyHorizonColor: { value: new THREE.Color(0xb6daf7) },
        uSkyZenithColor: { value: new THREE.Color(0x2563bd) },
        uNightFactor: { value: 0.0 },
        uTwilightFactor: { value: 0.0 },
        uMistDensity: { value: 0.35 },
        uWaterLevel: { value: -0.35 },
        uElapsed: { value: 0.0 },
        uBloomStrength: { value: 0.26 },
        uDofEnabled: { value: 1.0 },
        uFocusDistance: { value: 28.0 },
        uAperture: { value: 0.28 },
        uTiltShiftAmount: { value: 0.36 },
      },
    });

    this._finalMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: FINAL_DISPLAY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tPreDof: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uDofEnabled: { value: 1.0 },
        uNightFactor: { value: 0.0 },
        uExposure: { value: 1.05 },
      },
    });
  }

  _getQualityConfig() {
    if (this._quality === 'ultra') {
      return { samples: 4, aoScale: 0.75, aoDirs: 4, aoSteps: 3 };
    }
    if (this._quality === 'balanced') {
      return { samples: 0, aoScale: 0.5, aoDirs: 3, aoSteps: 2 };
    }
    return { samples: 4, aoScale: 0.55, aoDirs: 4, aoSteps: 3 };
  }

  _allocateTargets() {
    this._disposeTargets();

    const w = Math.max(2, this._width);
    const h = Math.max(2, this._height);
    const cfg = this._getQualityConfig();

    // Pass 1 HDR Scene Target + 32F Hardware DepthTexture
    this.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.depthTexture.format = THREE.DepthFormat;
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;

    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: this.depthTexture,
      samples: cfg.samples,
    });
    // Force core WebGL2 multisample renderbuffer + blitFramebuffer resolve (avoids ANGLE EXT_multisampled_render_to_texture bug with DepthTexture)
    if (this.renderer && this.renderer.properties) {
      this.renderer.properties.get(this.sceneRT).__useRenderToTexture = false;
    }

    const aoW = Math.max(2, Math.round(w * cfg.aoScale));
    const aoH = Math.max(2, Math.round(h * cfg.aoScale));
    const singleChannelOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this.aoRawRT = new THREE.WebGLRenderTarget(aoW, aoH, singleChannelOpts);
    this.aoBlurRT = new THREE.WebGLRenderTarget(aoW, aoH, singleChannelOpts);

    const grW = Math.max(2, Math.round(w * 0.5));
    const grH = Math.max(2, Math.round(h * 0.5));
    this.godRayRT = new THREE.WebGLRenderTarget(grW, grH, singleChannelOpts);

    this.bloomDownRTs = [];
    this.bloomUpRTs = [];
    let bw = Math.max(2, Math.floor(w * 0.5));
    let bh = Math.max(2, Math.floor(h * 0.5));
    for (let i = 0; i < BLOOM_MIPS; i++) {
      this.bloomDownRTs.push(new THREE.WebGLRenderTarget(bw, bh, singleChannelOpts));
      if (i < BLOOM_MIPS - 1) {
        this.bloomUpRTs.push(new THREE.WebGLRenderTarget(bw, bh, singleChannelOpts));
      }
      bw = Math.max(2, Math.floor(bw * 0.5));
      bh = Math.max(2, Math.floor(bh * 0.5));
    }

    this.preDofRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this._gtaoMat.uniforms.uDirs.value = cfg.aoDirs;
    this._gtaoMat.uniforms.uSteps.value = cfg.aoSteps;
  }

  _disposeTargets() {
    if (this.sceneRT) {
      this.sceneRT.dispose();
      this.sceneRT = null;
    }
    if (this.depthTexture) {
      this.depthTexture.dispose();
      this.depthTexture = null;
    }
    if (this.aoRawRT) {
      this.aoRawRT.dispose();
      this.aoRawRT = null;
    }
    if (this.aoBlurRT) {
      this.aoBlurRT.dispose();
      this.aoBlurRT = null;
    }
    if (this.godRayRT) {
      this.godRayRT.dispose();
      this.godRayRT = null;
    }
    if (this.bloomDownRTs) {
      for (let i = 0; i < this.bloomDownRTs.length; i++) this.bloomDownRTs[i].dispose();
      this.bloomDownRTs = null;
    }
    if (this.bloomUpRTs) {
      for (let i = 0; i < this.bloomUpRTs.length; i++) this.bloomUpRTs[i].dispose();
      this.bloomUpRTs = null;
    }
    if (this.preDofRT) {
      this.preDofRT.dispose();
      this.preDofRT = null;
    }
  }

  resize(width, height) {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (w === this._width && h === this._height && this.sceneRT) return;
    this._width = w;
    this._height = h;
    this._allocateTargets();
  }

  setQuality(quality) {
    const q = (quality || 'high').toLowerCase();
    if (q === this._quality) return;
    this._quality = q;
    this._allocateTargets();
  }

  setDoF(optsOrEnabled, aperture, focusDistance) {
    if (typeof optsOrEnabled === 'object' && optsOrEnabled !== null) {
      if (typeof optsOrEnabled.enabled === 'boolean') {
        this.dofState.enabled = optsOrEnabled.enabled;
      }
      if (typeof optsOrEnabled.aperture === 'number') {
        this.dofState.aperture = Math.max(0.0, Math.min(1.5, optsOrEnabled.aperture));
      }
      const fd = optsOrEnabled.focusDistance ?? optsOrEnabled.focus;
      if (typeof fd === 'number' && fd > 0) {
        this.dofState.focusDistance = fd;
        if (optsOrEnabled.autoFocus === undefined) {
          this.dofState.autoFocus = false;
        }
      }
      if (typeof optsOrEnabled.autoFocus === 'boolean') {
        this.dofState.autoFocus = optsOrEnabled.autoFocus;
      }
      if (typeof optsOrEnabled.tiltShift === 'number') {
        this.dofState.tiltShift = Math.max(0.0, Math.min(1.0, optsOrEnabled.tiltShift));
      }
    } else {
      if (typeof optsOrEnabled === 'boolean') {
        this.dofState.enabled = optsOrEnabled;
      }
      if (typeof aperture === 'number') {
        this.dofState.aperture = Math.max(0.0, Math.min(1.5, aperture));
      }
      if (typeof focusDistance === 'number' && focusDistance > 0) {
        this.dofState.focusDistance = focusDistance;
      }
    }
  }

  _runFullscreenPass(material, target) {
    this._fsMesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._fsScene, this._fsCam);
  }

  render(scene, camera, envState, elapsed = 0.0) {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = true;

    // Ensure ANGLE __useRenderToTexture stays disabled on MSAA + DepthTexture target
    if (this.sceneRT.samples > 0 && r.properties) {
      r.properties.get(this.sceneRT).__useRenderToTexture = false;
    }

    // --- PASS 1: Main HDR Scene Render (4x MSAA + 32F DepthTexture resolved cleanly) ---
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    // Capture true scene drawCalls & triangles right after Pass 1 before fullscreen quad passes!
    this.lastSceneCalls = r.info.render.calls;
    this.lastSceneTriangles = r.info.render.triangles;

    camera.updateMatrixWorld();
    const projEl = camera.projectionMatrix.elements;
    const invFx = 1.0 / Math.max(Math.abs(projEl[0]), 1e-5);
    const invFy = 1.0 / Math.max(Math.abs(projEl[5]), 1e-5);

    this._invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this._viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    // --- PASS 2: Screen-Space GTAO + Depth-Aware Bilateral Blur ---
    const gtaoU = this._gtaoMat.uniforms;
    gtaoU.tDepth.value = this.depthTexture;
    gtaoU.uResolution.value.set(this.aoRawRT.width, this.aoRawRT.height);
    gtaoU.uNear.value = camera.near;
    gtaoU.uFar.value = camera.far;
    gtaoU.uInvFocalLen.value.set(invFx, invFy);
    this._runFullscreenPass(this._gtaoMat, this.aoRawRT);

    const bilU = this._bilateralMat.uniforms;
    bilU.tAo.value = this.aoRawRT.texture;
    bilU.tDepth.value = this.depthTexture;
    bilU.uTexelSize.value.set(1.0 / this.aoRawRT.width, 1.0 / this.aoRawRT.height);
    bilU.uNear.value = camera.near;
    bilU.uFar.value = camera.far;
    this._runFullscreenPass(this._bilateralMat, this.aoBlurRT);

    // --- PASS 3: Screen-Space Volumetric Sun Shafts (God Rays) ---
    const sunDir = envState.sunDirection;
    camera.getWorldDirection(this._tmpCamFwd);
    const cosLookSun = this._tmpCamFwd.dot(sunDir);
    const sunHorizonVis = Math.max(0.0, Math.min(1.0, (sunDir.y + 0.05) / 0.25));

    let shaftWeight = 0.0;
    if (cosLookSun > 0.02 && sunHorizonVis > 0.01 && envState.nightFactor < 0.9) {
      this._tmpSunClip.set(
        camera.position.x + sunDir.x * 400.0,
        camera.position.y + sunDir.y * 400.0,
        camera.position.z + sunDir.z * 400.0,
        1.0
      ).applyMatrix4(this._viewProj);

      if (this._tmpSunClip.w > 0.01) {
        const sunUvX = (this._tmpSunClip.x / this._tmpSunClip.w) * 0.5 + 0.5;
        const sunUvY = (this._tmpSunClip.y / this._tmpSunClip.w) * 0.5 + 0.5;
        this._godRaysMat.uniforms.uSunScreenUv.value.set(sunUvX, sunUvY);

        const offScreenDist = Math.max(Math.abs(sunUvX - 0.5), Math.abs(sunUvY - 0.5)) * 2.0;
        const screenFade = 1.0 - Math.max(0.0, Math.min(1.0, (offScreenDist - 0.75) / 0.95));
        const mistBoost = 0.55 + (envState.mist ?? 0.35) * 0.85;
        shaftWeight = cosLookSun * sunHorizonVis * screenFade * mistBoost * (1.0 - envState.nightFactor);
      }
    }
    this._godRaysMat.uniforms.tDepth.value = this.depthTexture;
    this._godRaysMat.uniforms.uShaftWeight.value = shaftWeight;
    this._runFullscreenPass(this._godRaysMat, this.godRayRT);

    // --- PASS 4: Multi-Mip HDR Bloom Pyramid ---
    let prevTex = this.sceneRT.texture;
    let prevW = this.sceneRT.width;
    let prevH = this.sceneRT.height;

    for (let i = 0; i < BLOOM_MIPS; i++) {
      const target = this.bloomDownRTs[i];
      this._bloomDownMat.uniforms.tInput.value = prevTex;
      this._bloomDownMat.uniforms.uTexelSize.value.set(1.0 / prevW, 1.0 / prevH);
      this._bloomDownMat.uniforms.uIsFirstMip.value = i === 0 ? 1.0 : 0.0;
      this._runFullscreenPass(this._bloomDownMat, target);
      prevTex = target.texture;
      prevW = target.width;
      prevH = target.height;
    }

    let lowMipTex = this.bloomDownRTs[BLOOM_MIPS - 1].texture;
    let lowMipW = this.bloomDownRTs[BLOOM_MIPS - 1].width;
    let lowMipH = this.bloomDownRTs[BLOOM_MIPS - 1].height;

    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const upTarget = this.bloomUpRTs[i];
      this._bloomUpMat.uniforms.tLowMip.value = lowMipTex;
      this._bloomUpMat.uniforms.tHighMip.value = this.bloomDownRTs[i].texture;
      this._bloomUpMat.uniforms.uTexelSize.value.set(1.0 / lowMipW, 1.0 / lowMipH);
      this._runFullscreenPass(this._bloomUpMat, upTarget);
      lowMipTex = upTarget.texture;
      lowMipW = upTarget.width;
      lowMipH = upTarget.height;
    }

    // --- PASS 5A: HDR + GTAO + Valley Mist + God Rays + Bloom + CoC ---
    const pdU = this._preDofMat.uniforms;
    pdU.tScene.value = this.sceneRT.texture;
    pdU.tDepth.value = this.depthTexture;
    pdU.tAo.value = this.aoBlurRT.texture;
    pdU.tGodRays.value = this.godRayRT.texture;
    pdU.tBloom.value = this.bloomUpRTs[0].texture;
    pdU.uInvViewProj.value.copy(this._invViewProj);
    pdU.uCameraPos.value.copy(camera.position);
    pdU.uNear.value = camera.near;
    pdU.uFar.value = camera.far;
    pdU.uSunDirection.value.copy(envState.sunDirection);
    pdU.uSunColor.value.copy(envState.sunColor);
    pdU.uSkyHorizonColor.value.copy(envState.skyHorizonColor);
    pdU.uSkyZenithColor.value.copy(envState.skyZenithColor);
    pdU.uNightFactor.value = envState.nightFactor;
    pdU.uTwilightFactor.value = envState.twilightFactor ?? 0.0;
    pdU.uMistDensity.value = envState.mist ?? 0.35;
    pdU.uWaterLevel.value = envState.waterLevel ?? -0.35;
    pdU.uElapsed.value = elapsed;
    pdU.uBloomStrength.value = 0.24 + envState.nightFactor * 0.1;
    pdU.uDofEnabled.value = this.dofState.enabled ? 1.0 : 0.0;
    pdU.uFocusDistance.value = this.dofState.focusDistance;
    pdU.uAperture.value = this.dofState.aperture;
    // Automatically relax tabletop tilt-shift edge band when camera is down in Walk Mode (camera.position.y < 4.5m)
    const walkSuppress = Math.max(0.0, Math.min(1.0, (camera.position.y - 3.2) / 4.5));
    pdU.uTiltShiftAmount.value = this.dofState.tiltShift * walkSuppress;
    this._runFullscreenPass(this._preDofMat, this.preDofRT);

    // --- PASS 5B: Vogel-Disk Bokeh DoF + CAS + AgX/Filmic Tone Mapping + Color Grading + Dither -> Screen ---
    const finU = this._finalMat.uniforms;
    finU.tPreDof.value = this.preDofRT.texture;
    finU.uResolution.value.set(this._width, this._height);
    finU.uDofEnabled.value = this.dofState.enabled ? 1.0 : 0.0;
    finU.uNightFactor.value = envState.nightFactor;
    // Slight night adaptation exposure lift so moonlit castle silhouettes & grass remain atmospheric & clear
    finU.uExposure.value = 1.02 + envState.nightFactor * 0.18;
    this._runFullscreenPass(this._finalMat, null);

    r.autoClear = prevAutoClear;
  }

  dispose() {
    this._disposeTargets();
    this._fsGeo.dispose();
    this._gtaoMat.dispose();
    this._bilateralMat.dispose();
    this._godRaysMat.dispose();
    this._bloomDownMat.dispose();
    this._bloomUpMat.dispose();
    this._preDofMat.dispose();
    this._finalMat.dispose();
  }
}
