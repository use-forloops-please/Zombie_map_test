import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

const gltfLoader = new GLTFLoader()
const gltfCache = new Map<string, Promise<GLTF>>()

/**
 * Loads a glTF/GLB file once per URL; later calls share the same parsed result. Callers
 * that modify the scene (as the map loader does) should load each URL for one owner only.
 */
export function loadGltf(url: string): Promise<GLTF> {
  let pending = gltfCache.get(url)
  if (!pending) {
    pending = gltfLoader.loadAsync(url)
    // Don't cache failures: a fixed file should load on the next try.
    pending.catch(() => gltfCache.delete(url))
    gltfCache.set(url, pending)
  }
  return pending
}

/** Forgets a cached glTF (e.g. when a map is unloaded, so a restart re-reads it fresh). */
export function evictGltf(url: string): void {
  gltfCache.delete(url)
}
