import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';
import { createNoise, mulberry32 } from '@/src/shared/noise';

const grainNoise = createNoise(7301);

/** Small shared pigment textures add grain without introducing new world objects. */
export function pigmentTexture(seed: number, bark = false): DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const rand = mulberry32(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fibers = bark
        ? Math.pow(Math.max(0, Math.sin(x * 0.42 + Math.sin(y * 0.06) * 0.7)), 12) * 42
        : Math.max(0, grainNoise(x * 0.15, y * 0.15)) * 16;
      const value = Math.round(232 + rand() * 23 - fibers);
      const at = (y * size + x) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = value;
      pixels[at + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export const mineralGrain = pigmentTexture(381);
export const barkGrain = pigmentTexture(1127, true);

/** Mineral bands and moss conform to the actual rock surface. */
export function paintMineral(geometry: BufferGeometry, base: number, moss = 0): void {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors: number[] = [];
  const uv: number[] = [];
  const stone = new Color(base);
  const green = new Color(0x82916b);
  const seam = new Color(0xeee6d4);
  const tint = new Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const weather = grainNoise(x * 3 + z * 1.8, y * 4);
    const band = Math.abs(Math.sin(y * 11 + x * 1.4 + grainNoise(x * 2, z * 2) * 2));
    tint.copy(stone).multiplyScalar(0.88 + weather * 0.17);
    tint.lerp(seam, Math.max(0, 1 - band * 5) * 0.28);
    tint.lerp(green, Math.max(0, normals.getY(i)) * moss * Math.max(0, weather + 0.4));
    colors.push(tint.r, tint.g, tint.b);
    uv.push((Math.atan2(z, x) / (Math.PI * 2)) * 4, y * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}
