export const vignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    intensity: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float intensity;
    varying vec2 vUv;

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float d = dot(q, q);
      float vig = smoothstep(0.85, 0.15, d * 1.4);
      col.rgb *= mix(1.0, vig, 0.55 * intensity);
      // subtle warm-cold split (orange highlights, teal shadows)
      float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      vec3 warm = col.rgb * vec3(1.04, 1.0, 0.95);
      vec3 cold = col.rgb * vec3(0.93, 0.98, 1.08);
      col.rgb = mix(cold, warm, smoothstep(0.2, 0.85, lum));
      // film grain (very subtle, time-stable noise)
      float n = fract(sin(dot(vUv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
      col.rgb += (n - 0.5) * 0.015;
      gl_FragColor = col;
    }
  `,
};
