import * as THREE from 'three';

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldDir;

void main() {
  vWorldDir = position;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform vec3 uSkyMoonDirection;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uSunRadiantColor;
uniform vec3 uGroundBounceColor;
uniform float uNightFactor;
uniform float uTwilightFactor;
uniform float uCloudiness;
uniform float uElapsed;
uniform float uWindStrength;
uniform float uCelestialAngle;
uniform float uIsIBL;

varying vec3 vWorldDir;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float valueNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloudFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    sum += amp * valueNoise2(p);
    p = rot * p * 2.04 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum;
}

float cloudFbmLite(vec2 p) {
  float sum = 0.0;
  float amp = 0.56;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    sum += amp * valueNoise2(p);
    p = rot * p * 2.07 + vec2(11.7, 5.3);
    amp *= 0.5;
  }
  return sum;
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  float denom = max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4);
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

vec3 evalStarfield(vec3 dir, float time) {
  float ca = cos(uCelestialAngle);
  float sa = sin(uCelestialAngle);
  vec3 celDir = vec3(ca * dir.x - sa * dir.z, dir.y, sa * dir.x + ca * dir.z);

  vec3 stars = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float scale = layer == 0 ? 64.0 : (layer == 1 ? 112.0 : 176.0);
    float densityCut = layer == 0 ? 0.892 : (layer == 1 ? 0.915 : 0.938);
    vec3 grid = celDir * scale;
    vec3 cell = floor(grid);
    vec3 local = fract(grid) - 0.5;
    float rnd = hash31(cell + float(layer) * 71.7);
    if (rnd > densityCut) {
      vec3 jitter = vec3(
        hash31(cell + 13.1) - 0.5,
        hash31(cell + 29.7) - 0.5,
        hash31(cell + 47.3) - 0.5
      ) * 0.54;
      float d = length(local - jitter);
      float radius = layer == 0 ? 0.165 : (layer == 1 ? 0.125 : 0.095);
      float core = smoothstep(radius, 0.0, d);
      float sharp = core * (0.45 + 0.55 * core);
      float twinkle = 0.70 + 0.30 * sin(time * (1.9 + rnd * 3.8) + rnd * 62.8);
      vec3 starTint = mix(vec3(0.74, 0.86, 1.0), vec3(1.0, 0.89, 0.72), hash31(cell + 91.5));
      float gain = layer == 0 ? 3.1 : (layer == 1 ? 1.95 : 1.25);
      stars += starTint * sharp * twinkle * gain;
    }
  }
  return stars;
}

void main() {
  vec3 dir = normalize(vWorldDir);

  // For IBL cubemap lower hemisphere: warm meadow/earth bounce so undersides of arches & eaves never reflect black void
  if (uIsIBL > 0.5 && dir.y < -0.04) {
    float nadirT = clamp(-dir.y, 0.0, 1.0);
    vec3 bounce = mix(uHorizonColor * 0.78, uGroundBounceColor, smoothstep(0.0, 0.55, nadirT));
    gl_FragColor = vec4(bounce, 1.0);
    return;
  }

  float up = max(dir.y, 0.0);
  // Shift visual sky gradient base slightly below y=0 so diorama island horizon (-0.10) transitions into rich azure/indigo sky
  float upGrad = uIsIBL > 0.5
    ? clamp(up / 0.72, 0.0, 1.0)
    : clamp((dir.y + 0.125) / 0.30, 0.0, 1.0);
  float cosSun = dot(dir, uSunDirection);
  float cosMoon = dot(dir, uSkyMoonDirection);

  // Rayleigh + Ozone + Mie analytical sky gradient
  float horizonBlend = clamp(pow(1.0 - upGrad, 2.2), 0.0, 1.0);
  vec3 skyCol = mix(uZenithColor, uHorizonColor, horizonBlend);

  // Rayleigh wide forward/backward lobe
  float rayleighPhase = 0.75 * (1.0 + cosSun * cosSun);
  skyCol += uHorizonColor * rayleighPhase * 0.065 * (1.0 - uNightFactor * 0.75);

  // Solar Mie scattering aureole & sunset horizon glow
  float sunVis = smoothstep(-0.18, 0.14, uSunDirection.y);
  float mieLobe = hgPhase(cosSun, 0.78) * 1.35 + hgPhase(cosSun, 0.93) * 0.28;
  float sunsetAzimuthBand = pow(clamp(cosSun * 0.5 + 0.5, 0.0, 1.0), 3.0) * pow(1.0 - upGrad, 2.6);
  vec3 sunsetScatter = mix(vec3(1.0, 0.58, 0.26), vec3(1.0, 0.38, 0.20), uTwilightFactor);
  skyCol += uSunRadiantColor * mieLobe * 0.36 * sunVis;
  skyCol += sunsetScatter * sunsetAzimuthBand * uTwilightFactor * 0.85;

  // Moon atmospheric corona & glow at night (tight, gentle non-blooming halo preserving deep indigo sky & stars)
  float moonVis = uNightFactor * smoothstep(-0.14, 0.08, uSkyMoonDirection.y);
  float moonAngleDelta = max(1.0 - cosMoon, 0.0);
  float moonGlow = exp(-moonAngleDelta * 240.0) * 0.22 + exp(-moonAngleDelta * 36.0) * 0.045;
  skyCol += vec3(0.46, 0.64, 0.96) * moonGlow * moonVis;

  // Compute cloud layer first so stars occlude naturally behind clouds while moon shines cleanly
  float cloudAlpha = 0.0;
  vec3 cloudCol = vec3(0.0);
  if (dir.y > -0.135 && uCloudiness > 0.01) {
    float effY = max(dir.y + 0.145, 0.025);
    float projDist = 1.0 / (effY + 0.15);
    vec2 windDrift = vec2(uElapsed * (0.0045 + uWindStrength * 0.009), uElapsed * 0.0022);
    vec2 cloudUv = dir.xz * projDist * 0.34 + windDrift;

    float nBase = uIsIBL > 0.5 ? cloudFbmLite(cloudUv) : cloudFbm(cloudUv);
    float nDetail = cloudFbmLite(cloudUv * 2.4 - windDrift * 1.4);
    float rawCloud = nBase * 0.76 + nDetail * 0.24;

    // Remap FBM [0.36..0.68] into full [0..1] billow range so 0.20-0.35 cloudiness yields crisp cumulus puffs
    float billow = clamp((rawCloud - 0.36) / 0.31, 0.0, 1.0);
    float cov = clamp(uCloudiness, 0.0, 1.0);
    float coverageThreshold = mix(0.76, 0.14, pow(cov, 0.68));
    float cloudDensity = smoothstep(coverageThreshold, coverageThreshold + 0.19, billow);
    float horizonFade = smoothstep(-0.125, -0.015, dir.y);
    float nightCloudThin = mix(1.0, 0.45, uNightFactor);
    cloudAlpha = cloudDensity * horizonFade * clamp(0.78 + cov * 0.20, 0.0, 0.96) * nightCloudThin;

    if (cloudAlpha > 0.002) {
      vec2 sunStep = uSunDirection.xz * 0.14;
      float nTowardSun = cloudFbmLite(cloudUv + sunStep);
      float selfLit = clamp(0.56 + (nBase - nTowardSun) * 2.7, 0.14, 1.0);
      float silverLining = pow(clamp(cosSun * 0.5 + 0.5, 0.0, 1.0), 3.6) * (1.0 - cloudDensity * 0.5);

      vec3 dayCloudBright = mix(vec3(1.18, 1.14, 1.08), uSunRadiantColor * 1.26, 0.34 + uTwilightFactor * 0.46);
      vec3 dayCloudShadow = mix(uZenithColor * 0.62 + vec3(0.14, 0.17, 0.24), vec3(0.36, 0.24, 0.35), uTwilightFactor * 0.72);

      vec3 nightCloudBright = vec3(0.18, 0.25, 0.40) + vec3(0.16, 0.22, 0.36) * clamp(cosMoon * 0.5 + 0.5, 0.0, 1.0);
      vec3 nightCloudShadow = vec3(0.05, 0.08, 0.15);

      vec3 cloudBright = mix(dayCloudBright, nightCloudBright, uNightFactor);
      vec3 cloudShadow = mix(dayCloudShadow, nightCloudShadow, uNightFactor);

      cloudCol = mix(cloudShadow, cloudBright, selfLit);
      cloudCol += uSunRadiantColor * silverLining * 0.62 * sunVis;
      cloudCol = mix(cloudCol, uHorizonColor, (1.0 - horizonFade) * 0.45);
    }
  }

  // Twinkling stars & subtle Milky Way band across diorama & walk sky
  if (uNightFactor > 0.05 && uIsIBL < 0.5 && dir.y > -0.145) {
    float horizonStarFade = smoothstep(-0.14, 0.025, dir.y);
    float moonBodyOcc = smoothstep(0.99895, 0.99925, cosMoon) * step(0.05, moonVis);
    vec3 starLight = evalStarfield(dir, uElapsed) * uNightFactor * horizonStarFade * (1.0 - moonBodyOcc);
    float galBand = exp(-pow(((dir.y + 0.08) * 0.72 - dir.x * 0.45 - 0.14) * 3.6, 2.0));
    float galNoise = cloudFbmLite(dir.xz * 3.2 + 4.0);
    starLight += vec3(0.06, 0.095, 0.17) * galBand * galNoise * uNightFactor * horizonStarFade;
    skyCol += starLight * (1.0 - cloudAlpha * 0.90);
  }

  // Blend cumulus clouds
  if (cloudAlpha > 0.002) {
    skyCol = mix(skyCol, cloudCol, cloudAlpha);
  }

  // Solar & Lunar discs (skip sharp discs in PMREM IBL to avoid specular ringing)
  if (uIsIBL < 0.5 && dir.y > -0.14) {
    float sunDisc = smoothstep(0.99935, 0.99972, cosSun) * smoothstep(-0.04, 0.04, uSunDirection.y);
    skyCol += uSunRadiantColor * sunDisc * 9.5 * (1.0 - cloudAlpha * 0.65);

    float moonDisc = smoothstep(0.9990, 0.99935, cosMoon) * moonVis;
    if (moonDisc > 0.001) {
      vec3 mCross = cross(uSkyMoonDirection, vec3(0.0, 1.0, 0.0));
      vec3 mRight = normalize(length(mCross) > 1e-3 ? mCross : vec3(1.0, 0.0, 0.0));
      vec3 mUp = cross(mRight, uSkyMoonDirection);
      vec2 moonLocalUv = vec2(dot(dir, mRight), dot(dir, mUp)) * 24.4;
      float r2 = clamp(dot(moonLocalUv, moonLocalUv), 0.0, 1.0);
      float mare = smoothstep(0.39, 0.62, cloudFbm(moonLocalUv * 1.7 + vec2(3.7, 8.1)));
      float craters = smoothstep(0.40, 0.64, cloudFbmLite(moonLocalUv * 4.2 - vec2(2.1, 5.4)));
      float surfaceRelief = clamp(mare * 0.76 + craters * 0.24, 0.0, 1.0);
      float limb = clamp(0.58 + 0.42 * sqrt(max(0.0, 1.0 - r2 * 0.88)), 0.52, 1.0);
      vec3 moonSurf = vec3(1.08, 1.16, 1.32) * (0.64 + 0.44 * surfaceRelief) * limb;
      skyCol = mix(skyCol, moonSurf, moonDisc * (1.0 - cloudAlpha * 0.45));
    }
  }

  // Below-horizon skirt blend below -0.14 so distant island rim never shows harsh gap
  if (dir.y < -0.13) {
    float downT = smoothstep(-0.13, -0.30, dir.y);
    skyCol = mix(skyCol, mix(uHorizonColor * 0.85, uGroundBounceColor, 0.6), downT);
  }

  gl_FragColor = vec4(max(skyCol, vec3(0.0)), 1.0);
}
`;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

const SHADOW_MAP_SIZES = {
  ultra: 4096,
  high: 2048,
  balanced: 1024,
};

export class AtmosphereSky {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;

    this._quality = (opts.quality || 'high').toLowerCase();
    this._shadowFrustumHalf = 55;

    // Shared Sky Shader Uniforms
    this.uniforms = {
      uSunDirection: { value: new THREE.Vector3(0.5, 0.42, 0.75).normalize() },
      uMoonDirection: { value: new THREE.Vector3(-0.5, 0.55, -0.66).normalize() },
      uSkyMoonDirection: { value: new THREE.Vector3(-0.54, 0.045, -0.84).normalize() },
      uZenithColor: { value: new THREE.Color('#2c63b8') },
      uHorizonColor: { value: new THREE.Color('#f2ba85') },
      uSunRadiantColor: { value: new THREE.Color('#ffd195') },
      uGroundBounceColor: { value: new THREE.Color('#3b4a2b') },
      uNightFactor: { value: 0.0 },
      uTwilightFactor: { value: 0.4 },
      uCloudiness: { value: opts.cloudiness ?? 0.32 },
      uElapsed: { value: 0.0 },
      uWindStrength: { value: opts.windStrength ?? 0.45 },
      uCelestialAngle: { value: 0.0 },
      uIsIBL: { value: 0.0 },
    };

    // Sky Dome Mesh
    const skyGeo = new THREE.SphereGeometry(420, 48, 32);
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.name = 'AtmosphereSkyDome';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.scene.add(this.skyMesh);

    // Directional Sun Light (Primary stabilized shadow caster)
    this.sunLight = new THREE.DirectionalLight(0xffdfb0, 2.8);
    this.sunLight.name = 'SunLight';
    this.sunLight.castShadow = true;
    const shadowSize = SHADOW_MAP_SIZES[this._quality] || 2048;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.left = -this._shadowFrustumHalf;
    this.sunLight.shadow.camera.right = this._shadowFrustumHalf;
    this.sunLight.shadow.camera.top = this._shadowFrustumHalf;
    this.sunLight.shadow.camera.bottom = -this._shadowFrustumHalf;
    this.sunLight.shadow.camera.near = 2.0;
    this.sunLight.shadow.camera.far = 195.0;
    this.sunLight.shadow.bias = -0.00032;
    this.sunLight.shadow.normalBias = 0.026;
    this.sunLight.shadow.radius = 1.45;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Cool Directional Moon Fill / Night Shadow Light
    this.moonLight = new THREE.DirectionalLight(0x8eb4f0, 0.0);
    this.moonLight.name = 'MoonLight';
    this.moonLight.castShadow = false;
    this.moonLight.shadow.mapSize.set(1024, 1024);
    this.moonLight.shadow.camera.left = -this._shadowFrustumHalf;
    this.moonLight.shadow.camera.right = this._shadowFrustumHalf;
    this.moonLight.shadow.camera.top = this._shadowFrustumHalf;
    this.moonLight.shadow.camera.bottom = -this._shadowFrustumHalf;
    this.moonLight.shadow.camera.near = 2.0;
    this.moonLight.shadow.camera.far = 195.0;
    this.moonLight.shadow.bias = -0.0004;
    this.moonLight.shadow.normalBias = 0.032;
    this.moonLight.shadow.radius = 1.8;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // Hemisphere Sky / Ground Bounce Light
    this.hemisphereLight = new THREE.HemisphereLight(0x9ec5ff, 0x4f5d38, 0.72);
    this.hemisphereLight.name = 'SkyGroundHemisphere';
    this.scene.add(this.hemisphereLight);

    // Lightweight Dedicated IBL Scene & PMREMGenerator
    this._pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this._pmremGenerator.compileCubemapShader();
    this._currentEnvRT = null;

    this._iblUniforms = {
      uSunDirection: this.uniforms.uSunDirection,
      uMoonDirection: this.uniforms.uMoonDirection,
      uSkyMoonDirection: this.uniforms.uSkyMoonDirection,
      uZenithColor: this.uniforms.uZenithColor,
      uHorizonColor: this.uniforms.uHorizonColor,
      uSunRadiantColor: this.uniforms.uSunRadiantColor,
      uGroundBounceColor: this.uniforms.uGroundBounceColor,
      uNightFactor: this.uniforms.uNightFactor,
      uTwilightFactor: this.uniforms.uTwilightFactor,
      uCloudiness: this.uniforms.uCloudiness,
      uElapsed: { value: 0.0 },
      uWindStrength: this.uniforms.uWindStrength,
      uCelestialAngle: this.uniforms.uCelestialAngle,
      uIsIBL: { value: 1.0 },
    };
    this._iblScene = new THREE.Scene();
    const iblGeo = new THREE.SphereGeometry(20, 24, 16);
    this._iblMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: this._iblUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    this._iblMesh = new THREE.Mesh(iblGeo, this._iblMat);
    this._iblScene.add(this._iblMesh);

    this._lastIBLTime = -999;
    this._lastIBLClouds = -999;
    this._lastIBLSeason = '';
    this._lastIBLWallMs = -9999;
    this._iblDirty = true;

    // Reusable scratch vectors & colors (zero per-frame GC allocations)
    this._tmpRight = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3();
    this._tmpAnchor = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);

    this._cDayZenith = new THREE.Color('#2563bd');
    this._cGoldZenith = new THREE.Color('#28519c');
    this._cNightZenith = new THREE.Color('#091328');

    this._cDayHorizon = new THREE.Color('#b6daf7');
    this._cGoldHorizon = new THREE.Color('#f4a261');
    this._cDuskHorizon = new THREE.Color('#5a4b7c');
    this._cNightHorizon = new THREE.Color('#162847');

    this._cNoonSun = new THREE.Color('#fff5e4');
    this._cGoldSun = new THREE.Color('#ffad5c');
    this._cDawnSun = new THREE.Color('#ff9468');

    this._cDayGround = new THREE.Color('#4b5d35');
    this._cAutumnGround = new THREE.Color('#664c2e');
    this._cSpringGround = new THREE.Color('#4c6939');
    this._cNightGround = new THREE.Color('#1b2638');
    this._cTmpA = new THREE.Color();
    this._cTmpB = new THREE.Color();
  }

  setQuality(quality) {
    const q = (quality || 'high').toLowerCase();
    if (q === this._quality) return;
    this._quality = q;
    const size = SHADOW_MAP_SIZES[q] || 2048;
    if (this.sunLight.shadow.mapSize.x !== size) {
      this.sunLight.shadow.mapSize.set(size, size);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
  }

  _stabilizeDirectionalLight(light, dir, focusCenter, shadowMapSize) {
    // Clamp shadow anchor near glade heart so [-55, 55] frustum covers entire diorama
    this._tmpAnchor.set(
      clamp(focusCenter ? focusCenter.x * 0.45 : 0, -16, 16),
      0.0,
      clamp(focusCenter ? focusCenter.z * 0.45 : 0, -16, 16)
    );

    // Deterministic light-space basis derived strictly from light direction (never camera rotation!)
    this._tmpRight.crossVectors(this._worldUp, dir);
    if (this._tmpRight.lengthSq() < 1e-5) {
      this._tmpRight.set(1, 0, 0);
    } else {
      this._tmpRight.normalize();
    }
    this._tmpUp.crossVectors(dir, this._tmpRight).normalize();

    const worldUnitsPerTexel = (this._shadowFrustumHalf * 2.0) / shadowMapSize;
    let lx = this._tmpAnchor.dot(this._tmpRight);
    let ly = this._tmpAnchor.dot(this._tmpUp);
    const lz = this._tmpAnchor.dot(dir);

    lx = Math.round(lx / worldUnitsPerTexel) * worldUnitsPerTexel;
    ly = Math.round(ly / worldUnitsPerTexel) * worldUnitsPerTexel;

    light.target.position
      .set(0, 0, 0)
      .addScaledVector(this._tmpRight, lx)
      .addScaledVector(this._tmpUp, ly)
      .addScaledVector(dir, lz);
    light.target.updateMatrixWorld();

    light.position.copy(light.target.position).addScaledVector(dir, 92.0);
    light.updateMatrixWorld();
  }

  _timeDiffHours(a, b) {
    const d = Math.abs(a - b) % 24;
    return d > 12 ? 24 - d : d;
  }

  _regenerateIBL(envState, nowMs) {
    this._iblUniforms.uElapsed.value = this.uniforms.uElapsed.value;
    const prevTarget = this.renderer.getRenderTarget();
    const newEnvRT = this._pmremGenerator.fromScene(this._iblScene, 0.035, 0.5, 100);
    this.renderer.setRenderTarget(prevTarget);

    this.scene.environment = newEnvRT.texture;
    if (this._currentEnvRT) {
      this._currentEnvRT.dispose();
    }
    this._currentEnvRT = newEnvRT;

    this._lastIBLTime = envState.timeOfDay;
    this._lastIBLClouds = envState.cloudiness;
    this._lastIBLSeason = envState.season;
    this._lastIBLWallMs = nowMs;
    this._iblDirty = false;
  }

  update(elapsed, envState, camera, focusWorldPos) {
    const hours = (((envState.timeOfDay ?? 16.7) % 24) + 24) % 24;
    const cloudiness = clamp(envState.cloudiness ?? 0.32, 0.0, 1.0);
    const windStrength = Math.max(0.0, envState.windStrength ?? 0.45);
    const season = envState.season || 'summer';

    // Smooth continuous solar trajectory:
    // 6.2 = dawn (~+3.5°), 8.4 = morning (~+30°), 12.5 = noon (~+63°), 16.7 = golden hour (~+25°), 20.0 = blue hour (~-14°), 23.0 = night
    const solarPhase = ((hours - 12.35) / 24.0) * Math.PI * 2.0;
    const sinElev = clamp(0.09 + 0.8 * Math.cos(solarPhase), -0.85, 0.96);
    const cosElev = Math.sqrt(Math.max(0.0, 1.0 - sinElev * sinElev));
    // Scenic east-south-west arc so 16.7 Golden Hour rakes diagonally across the diorama
    const sunAzimuth = -0.35 + solarPhase * 0.92;

    const sunDir = envState.sunDirection;
    sunDir.set(
      Math.sin(sunAzimuth) * cosElev,
      sinElev,
      Math.cos(sunAzimuth) * cosElev
    ).normalize();

    // Moon light & water-glint direction (16°–22° elevation for dramatic castle shadows & pond sparkles)
    const moonElevSin = clamp(0.18 * Math.cos(solarPhase + Math.PI) + 0.22, -0.35, 0.42);
    const moonElevCos = Math.sqrt(Math.max(0.0, 1.0 - moonElevSin * moonElevSin));
    const moonAzimuth = 0.52 + Math.sin(solarPhase) * 0.28;
    const moonDir = envState.moonDirection;
    moonDir.set(
      Math.sin(moonAzimuth) * moonElevCos,
      moonElevSin,
      -Math.cos(moonAzimuth) * moonElevCos
    ).normalize();

    // Scenic low-horizon celestial Moon disc arc in the open upper-right sky bay (aligning with pond moon glints & castle shadows)
    const nightArc = Math.cos(solarPhase + Math.PI); // peaks near midnight
    const skyMoonElev = clamp(-0.08 + 0.102 * smoothstep(-0.35, 0.85, nightArc), -0.25, 0.032);
    const skyMoonCos = Math.sqrt(Math.max(0.0, 1.0 - skyMoonElev * skyMoonElev));
    const skyMoonAz = 0.12 + Math.sin(solarPhase) * 0.03;
    this.uniforms.uSkyMoonDirection.value
      .set(Math.sin(skyMoonAz) * skyMoonCos, skyMoonElev, -Math.cos(skyMoonAz) * skyMoonCos)
      .normalize();

    // Continuous atmospheric state factors (richer golden warmth at 16.7 Golden Hour & 6.2 Dawn)
    const nightFactor = smoothstep(0.14, -0.22, sinElev);
    const twilightFactor =
      smoothstep(0.58, 0.08, Math.abs(sinElev - 0.12)) * (1.0 - smoothstep(-0.18, -0.36, sinElev));
    const goldenWarmth = smoothstep(0.68, 0.12, sinElev) * (1.0 - smoothstep(-0.04, -0.22, sinElev));
    const isMorning = hours < 12.0;

    envState.nightFactor = nightFactor;
    envState.twilightFactor = twilightFactor;

    // Sky Zenith & Horizon Colors
    this._cTmpA.copy(this._cDayZenith).lerp(this._cGoldZenith, goldenWarmth * 0.72);
    if (season === 'spring') {
      this._cTmpA.offsetHSL(-0.012, 0.04, 0.03);
    } else if (season === 'autumn') {
      this._cTmpA.offsetHSL(0.008, -0.04, -0.01);
    }
    this._cTmpA.lerp(this._cNightZenith, nightFactor);
    this.uniforms.uZenithColor.value.copy(this._cTmpA);
    envState.skyZenithColor.copy(this._cTmpA);

    // Horizon transitions smoothly: bright azure-cream -> golden apricot -> twilight violet -> moonlit slate-indigo
    this._cTmpB.copy(this._cDayHorizon).lerp(this._cGoldHorizon, goldenWarmth * 0.92);
    if (isMorning && goldenWarmth > 0.1) {
      // Rose-peach tint at dawn
      this._cTmpB.offsetHSL(-0.025, 0.06, 0.02);
    }
    const deepDusk = smoothstep(-0.02, -0.22, sinElev) * (1.0 - smoothstep(-0.22, -0.42, sinElev));
    this._cTmpB.lerp(this._cDuskHorizon, deepDusk * 0.65);
    this._cTmpB.lerp(this._cNightHorizon, smoothstep(-0.08, -0.32, sinElev));
    this.uniforms.uHorizonColor.value.copy(this._cTmpB);
    envState.skyHorizonColor.copy(this._cTmpB);

    // Sun Radiant Color
    const warmTarget = isMorning ? this._cDawnSun : this._cGoldSun;
    this._cTmpA.copy(this._cNoonSun).lerp(warmTarget, goldenWarmth);
    if (season === 'autumn') {
      this._cTmpA.offsetHSL(-0.01, 0.06, 0.0);
    }
    this.uniforms.uSunRadiantColor.value.copy(this._cTmpA);
    envState.sunColor.copy(this._cTmpA);

    // Seasonal Ground Bounce Color
    const baseGround =
      season === 'autumn'
        ? this._cAutumnGround
        : season === 'spring'
          ? this._cSpringGround
          : this._cDayGround;
    this._cTmpB.copy(baseGround).lerp(this._cNightGround, nightFactor);
    this.uniforms.uGroundBounceColor.value.copy(this._cTmpB);
    envState.groundBounceColor.copy(this._cTmpB);

    // Cloud damping on direct sun, boosting soft sky bounce
    const cloudDirectAtten = 1.0 - cloudiness * 0.42;
    const sunAbove = smoothstep(-0.06, 0.16, sinElev);
    const sunIntensity = sunAbove * lerpScalar(2.35, 3.35, 1.0 - goldenWarmth * 0.35) * cloudDirectAtten;

    this.sunLight.color.copy(envState.sunColor);
    this.sunLight.intensity = sunIntensity;

    // Moon directional fill & soft night shadows (never pitch-black crushed shadows!)
    const moonStrength = smoothstep(0.28, 0.85, nightFactor) * (1.0 - cloudiness * 0.35);
    this.moonLight.intensity = moonStrength * 0.92;

    // Exclusive shadow caster cross-over so night scenes get soft moon shadows with zero double-4K shadow overhead
    const useMoonShadows = nightFactor > 0.68 && sunIntensity < 0.08;
    if (this.sunLight.castShadow === useMoonShadows) {
      this.sunLight.castShadow = !useMoonShadows;
    }
    if (this.moonLight.castShadow !== useMoonShadows) {
      this.moonLight.castShadow = useMoonShadows;
    }

    const sunMapSize = SHADOW_MAP_SIZES[this._quality] || 2048;
    this._stabilizeDirectionalLight(this.sunLight, sunDir, focusWorldPos, sunMapSize);
    this._stabilizeDirectionalLight(this.moonLight, moonDir, focusWorldPos, 1024);

    // Hemisphere Sky/Ground Bounce Light
    this.hemisphereLight.color.copy(envState.skyZenithColor).lerp(envState.skyHorizonColor, 0.52);
    if (nightFactor > 0.2) {
      // Lift night sky bounce slightly toward luminous moonlit periwinkle so dark stone & grass stay legible
      this._cTmpA.set('#46679e');
      this.hemisphereLight.color.lerp(this._cTmpA, nightFactor * 0.55);
    }
    this.hemisphereLight.groundColor.copy(envState.groundBounceColor);
    this.hemisphereLight.intensity =
      lerpScalar(0.88, 0.52, nightFactor) * (1.0 + cloudiness * 0.18);
    envState.ambientIntensity = this.hemisphereLight.intensity;
    this.scene.environmentIntensity = lerpScalar(0.95, 0.62, nightFactor);

    // Sync Sky Dome Uniforms & Center Dome on Camera XZ
    this.uniforms.uSunDirection.value.copy(sunDir);
    this.uniforms.uMoonDirection.value.copy(moonDir);
    this.uniforms.uNightFactor.value = nightFactor;
    this.uniforms.uTwilightFactor.value = twilightFactor;
    this.uniforms.uCloudiness.value = cloudiness;
    this.uniforms.uElapsed.value = elapsed;
    this.uniforms.uWindStrength.value = windStrength;
    this.uniforms.uCelestialAngle.value = (hours / 24.0) * Math.PI * 2.0;

    if (camera) {
      this.skyMesh.position.set(camera.position.x, 0.0, camera.position.z);
    }

    // Throttled leak-free dynamic PMREM IBL regeneration
    const changedEnough =
      this._timeDiffHours(hours, this._lastIBLTime) > 0.12 ||
      Math.abs(cloudiness - this._lastIBLClouds) > 0.06 ||
      season !== this._lastIBLSeason;

    if (changedEnough) {
      this._iblDirty = true;
    }

    if (this._iblDirty) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (this._currentEnvRT === null || nowMs - this._lastIBLWallMs >= 90) {
        this._regenerateIBL(
          { timeOfDay: hours, cloudiness, season },
          nowMs
        );
      }
    }
  }

  dispose() {
    this.scene.remove(this.skyMesh);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.moonLight);
    this.scene.remove(this.moonLight.target);
    this.scene.remove(this.hemisphereLight);

    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose();
    this._iblMesh.geometry.dispose();
    this._iblMat.dispose();

    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
    }
    if (this.moonLight.shadow.map) {
      this.moonLight.shadow.map.dispose();
    }
    if (this._currentEnvRT) {
      this._currentEnvRT.dispose();
      this._currentEnvRT = null;
    }
    if (this.scene.environment) {
      this.scene.environment = null;
    }
    this._pmremGenerator.dispose();
  }
}

function lerpScalar(a, b, t) {
  return a + (b - a) * t;
}
