import React, { useState } from 'react';
import {
  Card,
  Badge,
  Button,
  Form,
  Modal,
  Tooltip,
  toast,
  contextMenu,
} from '../../components';
import {
  LayersIcon,
  CheckCircleIcon,
  SparklesIcon,
  HelpIcon,
  SettingsIcon,
  RefreshIcon,
  ZapIcon,
  InfoIcon,
} from '../../assets/icons';
import { ClaudeMdCard } from './ClaudeMdCard';
import { InventoryCard } from './InventoryCard';

export const ComponentsTab: React.FC = () => {
  // Demo states
  const [toggleVal, setToggleVal] = useState(true);
  const [inputVal, setInputVal] = useState('');
  const [selectVal, setSelectVal] = useState('electron');
  const [sliderVal, setSliderVal] = useState(65);
  const [checkboxVal, setCheckboxVal] = useState(true);
  const [segmentedVal, setSegmentedVal] = useState('standard');
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCustomContextMenu = (e: React.MouseEvent) => {
    contextMenu.open(e, [
      {
        label: 'Custom Element Action',
        icon: <SparklesIcon size={14} />,
        onClick: () => toast.success('Custom item action clicked!'),
      },
      {
        label: 'Copy Details',
        shortcut: 'Ctrl+C',
        onClick: () => toast.info('Copied element metadata!'),
      },
      { separator: true, label: '' },
      {
        label: 'Delete / Reset Item',
        danger: true,
        onClick: () => toast.error('Item action cancelled.'),
      },
    ]);
  };

  return (
    <div className="view-list">
      <InventoryCard
        path="src/ui/components"
        items={[
          { name: 'Button', note: 'primary / secondary / subtle / danger, in three sizes' },
          { name: 'Badge', note: 'stamp labels: accent, neutral, success, warning, danger' },
          { name: 'Card', note: 'compound surface: Header, ExpandableHeader, Body, Footer' },
          { name: 'Form', note: 'Row, Toggle, Segmented, Input, Select, Checkbox, Slider' },
          { name: 'Modal', note: 'backdrop dialog, rendered through the OverlayHost portal' },
          { name: 'Toast', note: <>imperative notifications — <code>toast.success('…')</code> from anywhere</> },
          { name: 'ContextMenu', note: <>right-click menu — <code>contextMenu.open(e, items)</code></> },
          { name: 'Tooltip', note: 'hover/focus bubble with an optional shortcut pill' },
          { name: 'ErrorBoundary', note: 'catches render errors and shows a recovery card' },
        ]}
      />

      {/* Demos below follow the inventory order, one card per component */}
      <Card title="Button" subtitle="Variants and sizes" icon={<ZapIcon size={20} />}>
        <Form.Row label="Variants" description="The four intents, at the small size">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="sm" variant="primary">Primary</Button>
            <Button size="sm" variant="secondary">Secondary</Button>
            <Button size="sm" variant="subtle">Subtle</Button>
            <Button size="sm" variant="danger">Danger</Button>
          </div>
        </Form.Row>
        <Form.Row label="Sizes" description="sm, md, and lg">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="sm" variant="secondary">Small</Button>
            <Button size="md" variant="secondary">Medium</Button>
            <Button size="lg" variant="secondary">Large</Button>
          </div>
        </Form.Row>
      </Card>

      <Card title="Badge" subtitle="The five variants" icon={<CheckCircleIcon size={20} />}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
        </div>
      </Card>

      <Card>
        <Card.ExpandableHeader
          title="Card"
          subtitle="This card demos itself — click the header to toggle the body"
          icon={<LayersIcon size={20} />}
          isExpanded={isCardExpanded}
          onToggle={() => setIsCardExpanded(!isCardExpanded)}
          action={<Badge variant="neutral">{isCardExpanded ? 'Open' : 'Collapsed'}</Badge>}
        />
        {isCardExpanded && (
          <Card.Body>
            <p className="setting-description">
              Plain cards take <code>title</code> / <code>subtitle</code> / <code>icon</code> / <code>action</code> props; compound parts (<code>Card.Header</code>, <code>Card.Body</code>, <code>Card.Footer</code>) compose the rest, and <code>Card.ExpandableHeader</code> adds the toggle behavior seen here.
            </p>
          </Card.Body>
        )}
      </Card>

      <Card title="Form" subtitle="Every control in the family, one row each" icon={<SettingsIcon size={20} />}>
        <Form.Row label="Form.Toggle" description="Sliding switch with keyboard support">
          <Form.Toggle checked={toggleVal} onChange={setToggleVal} ariaLabel="Demo toggle" />
        </Form.Row>
        <Form.Row label="Form.Segmented" description="Multi-choice selector">
          <Form.Segmented
            value={segmentedVal}
            onChange={setSegmentedVal}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'standard', label: 'Standard' },
              { value: 'relaxed', label: 'Relaxed' },
            ]}
          />
        </Form.Row>
        <Form.Row label="Form.Input" description="Text input with focus ring">
          <Form.Input
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Type sample text..."
          />
        </Form.Row>
        <Form.Row label="Form.Select" description="Styled native dropdown">
          <Form.Select
            value={selectVal}
            onChange={(e) => setSelectVal(e.target.value)}
            options={[
              { value: 'electron', label: 'Electron' },
              { value: 'react', label: 'React' },
              { value: 'vite', label: 'Vite' },
            ]}
          />
        </Form.Row>
        <Form.Row label="Form.Slider" description="Range slider with value readout">
          <Form.Slider value={sliderVal} onChange={setSliderVal} unit="%" ariaLabel="Demo slider" />
        </Form.Row>
        <div className="ui-checkbox-list">
          <Form.Checkbox
            isRow
            checked={checkboxVal}
            onChange={setCheckboxVal}
            label="Form.Checkbox"
            description="Checkbox row with a label and description"
          />
        </div>
      </Card>

      <Card title="Modal" subtitle="Dialog through the OverlayHost portal — Escape or click-outside dismisses" icon={<HelpIcon size={20} />}>
        <Button size="sm" variant="primary" onClick={() => setIsModalOpen(true)}>
          Open Modal
        </Button>
      </Card>

      <Card title="Toast" subtitle="Imperative — call toast.success() and friends from any code" icon={<InfoIcon size={20} />}>
        <div className="ui-btn-row">
          <Button size="sm" variant="secondary" onClick={() => toast.success('Workspace configuration saved!')}>
            Success
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast.error('Failed to sync remote repository.')}>
            Error
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast.warning('Storage limit approaching 90%.')}>
            Warning
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast.info('New Electron update available.')}>
            Info
          </Button>
        </div>
      </Card>

      <Card title="ContextMenu" subtitle="Imperative — contextMenu.open(event, items)" icon={<SparklesIcon size={20} />}>
        <p className="setting-description">
          There is no app-wide fallback menu: right-clicking empty space does nothing by design. An element with real actions attaches its own menu from an <code>onContextMenu</code> handler, like this box.
        </p>
        <div
          onContextMenu={handleCustomContextMenu}
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--bg-app)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.857rem',
            color: 'var(--text-secondary)',
            cursor: 'context-menu',
            userSelect: 'none',
            textAlign: 'center',
            width: '100%',
          }}
        >
          Right-click this box
        </div>
      </Card>

      <Card title="Tooltip" subtitle="Hover or focus the buttons" icon={<RefreshIcon size={20} />}>
        <div className="ui-btn-row">
          <Tooltip content="Reload application window" shortcut="Ctrl+R" position="top">
            <Button size="sm" variant="secondary" icon={<RefreshIcon size={14} />}>
              Top Tooltip
            </Button>
          </Tooltip>
          <Tooltip content="Navigate to system settings" shortcut="Ctrl+," position="bottom">
            <Button size="sm" variant="secondary" icon={<SettingsIcon size={14} />}>
              Bottom Tooltip
            </Button>
          </Tooltip>
        </div>
      </Card>

      <ClaudeMdCard dir="components" />

      {/* Modal Dialog Instance */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Modal Dialog"
        subtitle="The compound modal primitive"
        icon={<HelpIcon size={20} />}
        size="md"
      >
        <Modal.Body>
          <p>
            This modal is rendered via <code>&lt;Modal&gt;</code> through the top-level <code>OverlayHost</code> portal.
          </p>
          <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
            It dims the backdrop and closes on <kbd>Escape</kbd> or a click outside the container (both configurable via props).
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="subtle" onClick={() => setIsModalOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setIsModalOpen(false);
              toast.success('Modal action confirmed!');
            }}
          >
            Confirm Action
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};
