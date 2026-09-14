import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

export const SUPPORTED_MESH_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'ply'] as const;

export interface ParsedMesh {
  /** Normalised: centred on the origin, largest dimension 2 units, resting on y = 0. */
  object: THREE.Group;
  vertices: number;
  faces: number;
}

/** Used for anything that arrives without its own materials (obj/stl/ply). */
function neutralMaterial(vertexColors = false): THREE.MeshStandardMaterial {
  // A clay-like neutral: the scene lighting, not the albedo, does the work,
  // so it reads on both the dark and the light ground.
  return new THREE.MeshStandardMaterial({
    color: 0xc2c2c2,
    roughness: 0.6,
    metalness: 0.02,
    vertexColors,
    side: THREE.DoubleSide,
  });
}

function parseGltf(bytes: ArrayBuffer): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      bytes,
      '',
      (gltf) => resolve(gltf.scene),
      (err) => reject(err instanceof Error ? err : new Error(String((err as ErrorEvent)?.message ?? err)))
    );
  });
}

function geometryToMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const hasColor = Boolean(geometry.getAttribute('color'));
  return new THREE.Mesh(geometry, neutralMaterial(hasColor));
}

async function parseByExtension(bytes: ArrayBuffer, ext: string): Promise<THREE.Object3D> {
  switch (ext) {
    case 'glb':
    case 'gltf':
      return parseGltf(bytes);
    case 'obj': {
      const group = new OBJLoader().parse(new TextDecoder().decode(bytes));
      // OBJLoader hands out a default Phong per mesh; swap in our neutral.
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh;
          if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
          mesh.material = neutralMaterial();
        }
      });
      return group;
    }
    case 'stl':
      return geometryToMesh(new STLLoader().parse(bytes));
    case 'ply':
      return geometryToMesh(new PLYLoader().parse(bytes));
    default:
      throw new Error(`Unsupported mesh format ".${ext}"`);
  }
}

function countGeometry(root: THREE.Object3D): { vertices: number; faces: number } {
  let vertices = 0;
  let faces = 0;
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const g = (o as THREE.Mesh).geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    vertices += pos.count;
    faces += Math.floor((g.index ? g.index.count : pos.count) / 3);
  });
  return { vertices, faces };
}

/**
 * Fit the object into a 2-unit cube centred on the origin with its lowest
 * point on the floor grid. Done on a wrapper group so the source transforms
 * (GLB node hierarchies) stay untouched.
 */
function normalise(source: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.add(source);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return root;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2 / maxDim;
  root.scale.setScalar(scale);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -scaled.min.y, -center.z);
  root.updateMatrixWorld(true);
  return root;
}

export async function parseMeshBytes(bytes: ArrayBuffer, ext: string): Promise<ParsedMesh> {
  const source = await parseByExtension(bytes, ext);
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // GLBs exported by the worker keep whatever they carry; only fill gaps.
      if (!mesh.material) mesh.material = neutralMaterial();
    }
  });
  const { vertices, faces } = countGeometry(source);
  return { object: normalise(source), vertices, faces };
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

/** Free GPU-side resources of a whole subtree (geometry, materials, textures). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}
