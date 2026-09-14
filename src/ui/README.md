# UI Architecture & Guide (Beginner Friendly)

This folder contains the React frontend running inside our Electron desktop app. It is designed to be simple, clean, and easy to extend.

---

## Folder Breakdown

```text
src/ui/
├── assets/
│   ├── styles/         # Centralized, modular stylesheets
│   │   ├── variables.css   # Theme tokens (Dark/Light), 5 accents, layout sizes
│   │   ├── reset.css       # Box-sizing, typography resets, custom scrollbars
│   │   ├── primitives.css  # Button, Card, Badge, Kbd styling
│   │   ├── shell.css       # Desktop TopBar, draggable regions, LeftDock resizer
│   │   ├── views.css       # Page screens, grids, lists, and view cards
│   │   └── index.css       # Master stylesheet bundle (imported by main.tsx)
│   ├── icons/          # Centralized icon catalog (LogoIcon, Nav, Theme, Action icons)
│   │   ├── types.ts        # IconProps & IconComponent typings
│   │   ├── LogoIcon.tsx    # Custom vector logo component
│   │   └── index.ts        # Barrel export providing standard named app icons
│   ├── images/         # Local static raster images (PNG, JPG, WebP)
│   └── fonts/          # Custom font files organized per font family
│       ├── inter/          # Inter font files
│       └── fonts.css       # @font-face rules
│
├── components/         # Per-Component compound architecture
│   ├── Button/         # Button primitive & variants
│   │   ├── Button.tsx
│   │   └── index.ts
│   ├── Card/           # Compound Card (Card.Header, ExpandableHeader, Body, Footer)
│   │   ├── Card.tsx
│   │   ├── CardHeader.tsx
│   │   ├── CardExpandableHeader.tsx
│   │   ├── CardBody.tsx
│   │   ├── CardFooter.tsx
│   │   └── index.ts
│   ├── Badge/          # Status badge primitive
│   │   ├── Badge.tsx
│   │   └── index.ts
│   ├── Form/           # Compound Form (Form.Row, Segmented, Toggle, Input, Select, Checkbox, Slider)
│   │   ├── Form.tsx
│   │   ├── FormRow.tsx
│   │   ├── FormSegmented.tsx
│   │   ├── FormToggle.tsx
│   │   ├── FormInput.tsx
│   │   ├── FormSelect.tsx
│   │   ├── FormCheckbox.tsx
│   │   ├── FormSlider.tsx
│   │   └── index.ts
│   ├── Modal/          # Compound Modal (Modal.Header, Body, Footer)
│   ├── Toast/          # Imperative Toast notifications & ToastContainer
│   ├── ContextMenu/    # Floating desktop right-click menu
│   ├── Tooltip/        # Lightweight hover/focus tooltips with shortcut badges
│   └── index.ts        # Central components barrel export
│
├── hooks/              # Custom React hooks
│   ├── useWindowControls.ts     # Window minimize/maximize/close logic
│   └── useKeyboardShortcuts.ts  # Shortcuts (e.g. Ctrl+B to toggle dock)
│
├── shell/              # Desktop window chrome & frame
│   ├── TopBar.tsx          # Draggable title bar with dock toggle & window buttons
│   ├── LeftDock.tsx        # Resizable navigation sidebar with settings at bottom
│   ├── WindowControls.tsx  # Minimize, Maximize/Restore, Close buttons
│   ├── OverlayHost.tsx     # Master mount point for Toasts, ContextMenu & Modals
│   └── Shell.tsx           # Outer frame layout wrapper
│
├── stores/             # Lightweight global state
│   ├── dockStore.ts    # Dock state & width management (initializes to 240px expanded)
│   └── themeStore.ts   # Theme mode (System/Light/Dark) & Accent color selector
│
├── views/              # Modular screen directories
│   ├── Generate/       # three.js viewer + generation dock (landing view)
│   ├── Pipelines/      # node editor for generation pipelines
│   ├── Models/         # environment + model downloads
│   ├── Logs/           # general / errors / generation log viewer
│   ├── Developer/      # Developer workspace with 6 tabs (Components, Assets, Hooks, Stores, Shell, Views)
│   ├── Settings/       # Settings with Appearance (theme, fonts) and Storage tabs
│   ├── Help/           # User-facing documentation & shortcuts (HelpView.tsx, index.ts)
│   └── index.tsx       # Top-level ViewContainer router
│
├── App.tsx             # Root React component
├── main.tsx            # Entry point that mounts React to index.html
└── README.md           # This guide
```

---

## How To Add a New Screen (View)

Adding a new screen takes just 3 easy steps:

1. **Create your view folder** (`src/ui/views/MyScreen/MyScreenView.tsx` and `src/ui/views/MyScreen/index.ts`):
   ```tsx
   import React from 'react';
   import { Card } from '../../components';

   export const MyScreenView: React.FC = () => {
     return (
       <div className="view-container">
         <h1 className="view-title">My Screen</h1>
         <Card title="Hello World">This is my new view!</Card>
       </div>
     );
   };
   ```

2. **Add it to the View Router** (`src/ui/views/index.tsx`):
   ```tsx
   case 'myscreen':
     return <MyScreenView />;
   ```

3. **Add a button to the Left Dock** (`src/ui/shell/LeftDock.tsx`):
   ```tsx
   import { SparklesIcon } from '../assets/icons';

   const MAIN_NAV_ITEMS = [
     // ... existing items
     { id: 'myscreen', label: 'My Screen', icon: SparklesIcon },
   ];
   ```

---

## Shortcuts

- **`Ctrl + B`** (or **`Cmd + B`** on Mac): Toggle the left navigation dock open or closed from anywhere in the app.
