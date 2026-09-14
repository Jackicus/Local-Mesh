import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildGrid, disposeGrid } from './sceneGrid';
import { readSceneColors, watchTheme } from './sceneTheme';
import { viewerStore, type SceneController } from './viewerStore';

/** Where the camera sits relative to whatever it is framing. */
const VIEW_DIRECTION = new THREE.Vector3(1, 0.62, 1.15).normalize();
/** Framed when nothing is loaded, so the grid reads as a room, not a plane. */
const EMPTY_BOUNDS = new THREE.Box3(new THREE.Vector3(-1.2, 0, -1.2), new THREE.Vector3(1.2, 1.2, 1.2));

function setWireframeOn(root: THREE.Object3D | null, on: boolean) {
  root?.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const apply = (m: THREE.Material) => {
      if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = on;
    };
    if (Array.isArray(material)) material.forEach(apply);
    else if (material) apply(material);
  });
}

/**
 * Owns the WebGL context for the Generate viewport. Renders on demand: the
 * rAF loop only spins while the camera is actually moving (damping or
 * auto-rotate), so an idle window costs nothing.
 */
export function useThreeScene(containerRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI * 0.495; // never duck under the floor
    controls.autoRotateSpeed = 1.1;

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(3.5, 6, 2.5);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-4, 1.5, -3.5);
    scene.add(hemisphere, key, fill);

    let grid: THREE.Group | null = null;
    let content: THREE.Object3D | null = null;
    let gridVisible = true;
    let wireframe = false;

    let rafId = 0;
    let dirty = true;
    let idleFrames = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const moved = controls.update();
      if (moved || dirty) {
        renderer.render(scene, camera);
        dirty = false;
        idleFrames = 0;
      } else if (++idleFrames > 2) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const requestRender = () => {
      dirty = true;
      idleFrames = 0;
      if (!rafId) tick();
    };

    const applyTheme = () => {
      const colors = readSceneColors();
      scene.background = colors.background;
      // Only bites well past the grid's own fade, so distant geometry melts
      // into the same sheet the rest of the app is painted on.
      scene.fog = new THREE.Fog(colors.background, 16, 46);
      hemisphere.groundColor.copy(colors.background);
      if (grid) {
        scene.remove(grid);
        disposeGrid(grid);
      }
      // Colours are baked per vertex, so a theme or accent change rebuilds the
      // grid — that is what re-derives the fine, major and axis bases together.
      grid = buildGrid(colors);
      grid.visible = gridVisible;
      scene.add(grid);
      requestRender();
    };

    const frameContent = () => {
      const box = content ? new THREE.Box3().setFromObject(content) : EMPTY_BOUNDS.clone();
      if (box.isEmpty()) box.copy(EMPTY_BOUNDS);
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 0.4);
      const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.12;
      camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
      controls.target.copy(center);
      controls.update();
      requestRender();
    };

    const controller: SceneController = {
      setObject(object) {
        if (content) scene.remove(content);
        content = object;
        if (content) {
          setWireframeOn(content, wireframe);
          scene.add(content);
        }
        frameContent();
      },
      resetCamera: frameContent,
      setGrid(on) {
        gridVisible = on;
        if (grid) grid.visible = on;
        requestRender();
      },
      setWireframe(on) {
        wireframe = on;
        setWireframeOn(content, on);
        requestRender();
      },
      setAutoRotate(on) {
        controls.autoRotate = on;
        requestRender();
      },
    };

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      requestRender();
    };

    applyTheme();
    resize();
    frameContent();

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const unwatchTheme = watchTheme(applyTheme);
    controls.addEventListener('change', requestRender);
    const unregister = viewerStore.registerController(controller);

    return () => {
      unregister();
      unwatchTheme();
      observer.disconnect();
      controls.removeEventListener('change', requestRender);
      if (rafId) cancelAnimationFrame(rafId);
      // The loaded mesh belongs to viewerStore (it survives navigation), so
      // detach it rather than disposing it here.
      if (content) scene.remove(content);
      controls.dispose();
      if (grid) disposeGrid(grid);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [containerRef]);
}
