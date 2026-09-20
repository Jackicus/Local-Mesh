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
/** How long the gizmo takes to swing the camera onto an axis. */
const SNAP_MS = 420;
/**
 * A press that travels further than this, or lasts longer, was an orbit. The
 * canvas is OrbitControls' surface first and a hit target second, so selection
 * only ever happens on what is unmistakably a click.
 */
const CLICK_SLOP = 5;
const CLICK_MS = 500;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

    // A gizmo snap in flight: the camera is flown to `to` and handed back to
    // OrbitControls, which keeps looking at its own target throughout.
    const snapFrom = new THREE.Vector3();
    const snapTo = new THREE.Vector3();
    let snapStart = 0;

    const stepSnap = () => {
      if (snapStart === 0) return;
      const t = Math.min(1, (performance.now() - snapStart) / SNAP_MS);
      camera.position.lerpVectors(snapFrom, snapTo, easeOut(t));
      if (t >= 1) snapStart = 0;
      dirty = true;
    };

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      stepSnap();
      const moved = controls.update();
      if (moved || dirty) {
        renderer.render(scene, camera);
        const { x, y, z, w } = camera.quaternion;
        viewerStore.publishCameraPose([x, y, z, w]);
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
      snapToAxis(x, y, z) {
        const distance = camera.position.distanceTo(controls.target);
        // OrbitControls clamps the polar angle so the camera never ducks under
        // the grid; aiming dead-on at an axis would sit exactly on that limit,
        // so the poles are nudged a hair inside it and stay stable.
        const direction = new THREE.Vector3(x, y, z).normalize();
        if (Math.abs(direction.y) > 0.999) direction.set(0, Math.sign(direction.y) * 0.9995, 0.032).normalize();
        snapTo.copy(controls.target).addScaledVector(direction, distance);
        if (prefersReducedMotion()) {
          snapStart = 0;
          camera.position.copy(snapTo);
        } else {
          snapFrom.copy(camera.position);
          snapStart = performance.now();
        }
        requestRender();
      },
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

    // Click the mesh to say "this one". The scene is single-object, so there
    // is nothing to disambiguate — the raycast is here to tell a click on the
    // model apart from a click on the empty room around it, which is the
    // difference between asserting a selection and nudging the camera.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let press: { x: number; y: number; at: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      press = event.button === 0 ? { x: event.clientX, y: event.clientY, at: performance.now() } : null;
    };

    const onPointerUp = (event: PointerEvent) => {
      const started = press;
      press = null;
      if (!started || !content) return;
      if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > CLICK_SLOP) return;
      if (performance.now() - started.at > CLICK_MS) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.intersectObject(content, true).length > 0) viewerStore.pingSelection();
    };

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      // Dragging the window onto a display of a different density changes the
      // ratio without changing the CSS size, so re-read it here rather than
      // only at construction.
      const ratio = Math.min(window.devicePixelRatio, 2);
      if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
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
    // Taking hold of the mouse always wins over an in-flight gizmo snap.
    const cancelSnap = () => {
      snapStart = 0;
    };
    controls.addEventListener('change', requestRender);
    controls.addEventListener('start', cancelSnap);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    const unregister = viewerStore.registerController(controller);

    return () => {
      unregister();
      unwatchTheme();
      observer.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.removeEventListener('start', cancelSnap);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
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
