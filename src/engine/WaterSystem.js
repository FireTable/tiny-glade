import * as THREE from 'three';

const MAX_RIPPLES = 16;

const WATER_VERTEX_SHADER = /* glsl */ `
uniform sampler2D uTerrainMap;
uniform float uWorldSize;
uniform float uWaterLevel;
uniform float uElapsed;
uniform float uWindStrength;

varying vec3 vWorldPos;
varying vec2 vTerrainUv;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 tUv = clamp(wp.xz / uWorldSize + 0.5, 0.002, 0.998);
  float terrainH = texture2D(uTerrainMap, tUv).r;
  float depth = max(0.0, uWaterLevel - terrainH);

  // Gentle Gerstner breathing only away from shoreline so shore contact stays pinned
  float deepMask = smoothstep(0.06, 0.55, depth);
  float windAmp = (0.008 + 0.018 * uWindStrength) * deepMask;
  float waveA = sin(wp.x * 1.45 + wp.z * 0.85 + uElapsed * 1.85);
  float waveB = cos(wp.x * 0.92 - wp.z * 1.68 + uElapsed * 1.42);
  wp.y += (waveA * 0.6 + waveB * 0.4) * windAmp;

  vWorldPos = wp.xyz;
  vTerrainUv = tUv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uTerrainMap;
uniform float uWorldSize;
uniform float uWaterLevel;
uniform float uElapsed;
uniform float uWindStrength;
uniform float uNightFactor;
uniform float uCloudiness;

uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uCameraPos;

uniform vec4 uRipples[${MAX_RIPPLES}];

varying vec3 vWorldPos;
varying vec2 vTerrainUv;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.53);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbmWater(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 m = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = m * p * 2.03 + vec2(11.3, 7.9);
    a *= 0.5;
  }
  return s;
}

// Crisp cellular Voronoi-like caustic network
float causticPattern(vec2 p, float t) {
  vec2 p1 = p * 2.35 + vec2(t * 0.32, -t * 0.24);
  vec2 p2 = p * 2.75 + vec2(-t * 0.27, t * 0.35);
  float w1 = abs(sin(p1.x + sin(p1.y * 1.4)) * cos(p1.y + cos(p1.x * 1.3)));
  float w2 = abs(sin(p2.x * 1.15 - cos(p2.y * 1.25)) * cos(p2.y * 1.1 + sin(p2.x * 1.35)));
  float ridge = pow(1.0 - min(w1, w2), 5.5);
  return clamp(ridge, 0.0, 1.4);
}

// Analytical multi-wave height for finite-difference normal ripples
float evalWaveHeight(vec2 xz, float t, float wind) {
  vec2 scrollA = xz * 1.85 + vec2(t * 0.52, t * 0.34);
  vec2 scrollB = xz * 3.15 + vec2(-t * 0.44, t * 0.61);
  vec2 scrollC = xz * 6.80 + vec2(t * 0.88, -t * 0.72);

  float h = 0.0;
  h += (fbmWater(scrollA) - 0.5) * 0.55;
  h += (fbmWater(scrollB) - 0.5) * 0.30;
  h += (vnoise(scrollC) - 0.5) * (0.12 + 0.14 * wind);
  return h * (0.55 + 0.75 * wind);
}

void main() {
  vec4 terrainSample = texture2D(uTerrainMap, vTerrainUv);
  float terrainHeight = terrainSample.r;
  float rawDiff = uWaterLevel - terrainHeight;

  // Discard cleanly above water shoreline (+2cm tolerance)
  if (rawDiff < -0.02) {
    discard;
  }

  float edgeAlpha = smoothstep(-0.018, 0.042, rawDiff);
  if (edgeAlpha <= 0.004) {
    discard;
  }

  float depth = max(0.0, rawDiff);
  vec3 viewVec = uCameraPos - vWorldPos;
  float camDist = length(viewVec);
  vec3 V = viewVec / max(camDist, 1e-4);

  // Dual-scrolling procedural wave normal
  float eps = 0.075;
  float hC = evalWaveHeight(vWorldPos.xz, uElapsed, uWindStrength);
  float hX = evalWaveHeight(vWorldPos.xz + vec2(eps, 0.0), uElapsed, uWindStrength);
  float hZ = evalWaveHeight(vWorldPos.xz + vec2(0.0, eps), uElapsed, uWindStrength);

  float distAtten = 1.0 - smoothstep(35.0, 105.0, camDist) * 0.65;
  float normalAmp = (0.20 + 0.16 * smoothstep(0.02, 0.35, depth)) * distAtten;
  vec2 grad = vec2(hX - hC, hZ - hC) / eps * normalAmp;

  // Interactive expanding ring ripples (ducks, sculpting, splashes)
  float rippleFoam = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 rp = uRipples[i];
    if (rp.w > 0.002 && rp.z >= 0.0 && rp.z < 3.8) {
      vec2 delta = vWorldPos.xz - rp.xy;
      float rDist = length(delta);
      float radius = rp.z * 2.85;
      float band = rDist - radius;
      float envelope = exp(-abs(band) * 3.2) * exp(-rp.z * 0.95) * rp.w;
      if (envelope > 0.001) {
        float phase = band * 13.5;
        vec2 rDir = delta / max(rDist, 1e-3);
        grad += rDir * cos(phase) * envelope * 0.24;
        rippleFoam += max(0.0, sin(phase)) * envelope * 0.35;
      }
    }
  }

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  // Refracted shallow pond bed + projected solar caustics
  vec2 refractXZ = vWorldPos.xz + N.xz * clamp(depth * 0.38, 0.0, 0.42);
  float bedGrain = fbmWater(refractXZ * 2.8);
  vec3 shallowPebbles = mix(vec3(0.46, 0.41, 0.32), vec3(0.62, 0.56, 0.44), bedGrain);

  float dayLight = clamp(1.0 - uNightFactor * 1.1, 0.0, 1.0);
  float sunNdotL = max(uSunDirection.y, 0.08);
  vec3 ambientBedLight = mix(uSkyHorizonColor * 0.55 + uSkyZenithColor * 0.35, vec3(0.07, 0.11, 0.20), uNightFactor);
  vec3 bedLit = shallowPebbles * (ambientBedLight + uSunColor * sunNdotL * 0.78 * dayLight);

  // Underwater caustics dancing across shallow pebbles & mid-depth banks
  float causticMask = smoothstep(0.015, 0.16, depth) * exp(-depth * 0.95) * dayLight * (1.0 - uCloudiness * 0.55);
  if (causticMask > 0.005) {
    vec2 causticCoord = refractXZ - uSunDirection.xz * depth * 0.38;
    float cVal = causticPattern(causticCoord, uElapsed);
    bedLit += uSunColor * cVal * causticMask * 0.72;
  }

  // Beer-Lambert depth absorption: crystal clear shore -> rich emerald-turquoise deep basin
  vec3 sigma = vec3(1.58, 0.46, 0.40);
  vec3 transmittance = exp(-sigma * depth * 1.65);

  vec3 dayDeepScatter = vec3(0.026, 0.165, 0.185) * (0.55 + sunNdotL * 0.85) + uSunColor * vec3(0.02, 0.08, 0.07) * dayLight;
  vec3 nightDeepScatter = vec3(0.014, 0.036, 0.075);
  vec3 deepWaterVolume = mix(dayDeepScatter, nightDeepScatter, uNightFactor);

  // Forward subsurface emerald glow when looking toward sun across deeper water
  float forwardSun = pow(clamp(dot(-V, uSunDirection), 0.0, 1.0), 3.0) * smoothstep(0.15, 1.1, depth) * dayLight;
  deepWaterVolume += vec3(0.05, 0.32, 0.28) * uSunColor * forwardSun * 0.45;

  vec3 underwaterColor = bedLit * transmittance + deepWaterVolume * (1.0 - transmittance);

  // Fresnel Sky, Cloud, Sun & Moon Reflection
  float NdotV = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.024 + 0.976 * pow(1.0 - NdotV, 5.0);
  fresnel = clamp(fresnel, 0.024, 0.90);

  vec3 R = reflect(-V, N);
  float reflUp = clamp(R.y, 0.0, 1.0);
  vec3 skyRefl = mix(uSkyHorizonColor, uSkyZenithColor, pow(reflUp, 0.62));

  // Subtle reflected cloud dapple so pond mirrors living sky
  if (uCloudiness > 0.02 && R.y > 0.02) {
    vec2 reflCloudUv = R.xz / (R.y + 0.22) * 0.38 + vec2(uElapsed * 0.006, uElapsed * 0.003);
    float cRefl = smoothstep(0.55 - uCloudiness * 0.25, 0.82, fbmWater(reflCloudUv));
    vec3 reflCloudTint = mix(vec3(0.95, 0.93, 0.90) * (0.5 + 0.6 * sunNdotL), vec3(0.14, 0.20, 0.32), uNightFactor);
    skyRefl = mix(skyRefl, reflCloudTint, cRefl * uCloudiness * 0.55);
  }

  vec3 waterColor = mix(underwaterColor, skyRefl, fresnel);

  // Crisp Solar Specular Road + HDR Sparkle Glints (Day & Golden Hour)
  if (dayLight > 0.005) {
    vec3 Hsun = normalize(uSunDirection + V);
    float NdotH = max(dot(N, Hsun), 0.0);
    float broadSheen = pow(NdotH, 72.0) * 0.45;
    float crispGlint = pow(NdotH, 620.0) * 3.8;
    float cloudSpecAtten = 1.0 - uCloudiness * 0.65;
    waterColor += uSunColor * (broadSheen + crispGlint) * dayLight * cloudSpecAtten * smoothstep(0.01, 0.12, depth);
  }

  // Poetic Silver Moonlit Reflection Path at Night
  if (uNightFactor > 0.02 && uMoonDirection.y > 0.0) {
    vec3 Hmoon = normalize(uMoonDirection + V);
    float NdotHm = max(dot(N, Hmoon), 0.0);
    float moonSheen = pow(NdotHm, 56.0) * 0.34 + pow(NdotHm, 380.0) * 1.45;
    waterColor += vec3(0.62, 0.78, 1.05) * moonSheen * uNightFactor * smoothstep(0.01, 0.12, depth);
  }

  // Animated Shoreline Foam Waves (0 < depth < 0.35) + Ripple Foam
  if (depth < 0.36 || rippleFoam > 0.01) {
    float shoreZone = 1.0 - smoothstep(0.04, 0.35, depth);
    float foamNoise = fbmWater(vWorldPos.xz * 3.4 - vec2(uElapsed * 0.18, uElapsed * 0.12));
    float wavePhase = sin(depth * 27.0 - uElapsed * 2.35 + foamNoise * 3.8);
    float waveBands = smoothstep(0.32, 0.88, wavePhase) * smoothstep(0.35, 0.02, depth) * smoothstep(0.004, 0.035, depth);
    float contactRim = smoothstep(0.065, 0.005, depth);
    float breakup = smoothstep(0.28, 0.72, foamNoise + contactRim * 0.45);

    float foamMask = clamp((contactRim * 0.78 + waveBands * 0.62 * shoreZone) * breakup + rippleFoam, 0.0, 0.92);
    vec3 foamLit = mix(
      uSkyHorizonColor * 0.48 + uSunColor * max(uSunDirection.y, 0.15) * 0.68,
      vec3(0.20, 0.28, 0.44),
      uNightFactor
    );
    waterColor = mix(waterColor, foamLit, foamMask);
  }

  gl_FragColor = vec4(max(waterColor, vec3(0.0)), edgeAlpha);
}
`;

export class WaterSystem {
  constructor(opts = {}) {
    this.worldSize = opts.worldSize ?? 120;
    this.waterLevel = opts.waterLevel ?? -0.35;

    // Default fallback 2x2 HalfFloat terrain height map above water until WorldManager binds real height map
    const fallbackHalf = THREE.DataUtils.toHalfFloat(10.0);
    const fallbackZero = THREE.DataUtils.toHalfFloat(0.0);
    const fallbackBuf = new Uint16Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      fallbackBuf[i * 4] = fallbackHalf;
      fallbackBuf[i * 4 + 1] = fallbackZero;
      fallbackBuf[i * 4 + 2] = fallbackZero;
      fallbackBuf[i * 4 + 3] = fallbackZero;
    }
    this._fallbackTerrainTex = new THREE.DataTexture(
      fallbackBuf,
      2,
      2,
      THREE.RGBAFormat,
      THREE.HalfFloatType
    );
    this._fallbackTerrainTex.flipY = false;
    this._fallbackTerrainTex.minFilter = THREE.LinearFilter;
    this._fallbackTerrainTex.magFilter = THREE.LinearFilter;
    this._fallbackTerrainTex.needsUpdate = true;

    this._rippleUniformArray = [];
    for (let i = 0; i < MAX_RIPPLES; i++) {
      this._rippleUniformArray.push(new THREE.Vector4(0, 0, 99.0, 0.0));
    }
    this._rippleCursor = 0;

    this.uniforms = {
      uTerrainMap: { value: this._fallbackTerrainTex },
      uWorldSize: { value: this.worldSize },
      uWaterLevel: { value: this.waterLevel },
      uElapsed: { value: 0.0 },
      uWindStrength: { value: 0.45 },
      uNightFactor: { value: 0.0 },
      uCloudiness: { value: 0.32 },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.42, 0.75).normalize() },
      uMoonDirection: { value: new THREE.Vector3(-0.5, 0.55, -0.66).normalize() },
      uSunColor: { value: new THREE.Color('#ffd195') },
      uSkyZenithColor: { value: new THREE.Color('#2c63b8') },
      uSkyHorizonColor: { value: new THREE.Color('#f2ba85') },
      uCameraPos: { value: new THREE.Vector3(0, 20, 25) },
      uRipples: { value: this._rippleUniformArray },
    };

    const segments = opts.segments ?? 160;
    const geometry = new THREE.PlaneGeometry(this.worldSize, this.worldSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'WaterSystemSurface';
    this.mesh.position.set(0, this.waterLevel, 0);
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;

    if (opts.scene) {
      opts.scene.add(this.mesh);
    }
  }

  updateTerrainTexture(heightDataTexture, worldSize = 120) {
    if (heightDataTexture) {
      this.uniforms.uTerrainMap.value = heightDataTexture;
    }
    if (typeof worldSize === 'number' && worldSize > 0) {
      this.worldSize = worldSize;
      this.uniforms.uWorldSize.value = worldSize;
    }
  }

  addRipple(x, z, strength = 1.0) {
    const slot = this._rippleUniformArray[this._rippleCursor];
    this._rippleCursor = (this._rippleCursor + 1) % MAX_RIPPLES;
    slot.set(x, z, 0.0, Math.min(Math.max(strength, 0.05), 2.5));
  }

  update(dt, elapsed, envState, camera) {
    const safeDt = Math.min(Math.max(dt || 0.016, 0.0), 0.1);
    this.uniforms.uElapsed.value = elapsed ?? this.uniforms.uElapsed.value + safeDt;

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const rp = this._rippleUniformArray[i];
      if (rp.w > 0.0) {
        rp.z += safeDt;
        if (rp.z >= 3.8) {
          rp.w = 0.0;
        }
      }
    }

    if (envState) {
      if (typeof envState.waterLevel === 'number' && envState.waterLevel !== this.waterLevel) {
        this.waterLevel = envState.waterLevel;
        this.uniforms.uWaterLevel.value = this.waterLevel;
        this.mesh.position.y = this.waterLevel;
      }
      if (typeof envState.windStrength === 'number') {
        this.uniforms.uWindStrength.value = envState.windStrength;
      }
      if (typeof envState.nightFactor === 'number') {
        this.uniforms.uNightFactor.value = envState.nightFactor;
      }
      if (typeof envState.cloudiness === 'number') {
        this.uniforms.uCloudiness.value = envState.cloudiness;
      }
      if (envState.sunDirection) {
        this.uniforms.uSunDirection.value.copy(envState.sunDirection);
      }
      if (envState.moonDirection) {
        this.uniforms.uMoonDirection.value.copy(envState.moonDirection);
      }
      if (envState.sunColor) {
        this.uniforms.uSunColor.value.copy(envState.sunColor);
      }
      if (envState.skyZenithColor) {
        this.uniforms.uSkyZenithColor.value.copy(envState.skyZenithColor);
      }
      if (envState.skyHorizonColor) {
        this.uniforms.uSkyHorizonColor.value.copy(envState.skyHorizonColor);
      }
    }

    if (camera && camera.position) {
      this.uniforms.uCameraPos.value.copy(camera.position);
    }
  }

  dispose() {
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    this.mesh.geometry.dispose();
    this.material.dispose();
    this._fallbackTerrainTex.dispose();
  }
}
