import React, { useState } from 'react';
import { Card, Badge, Form } from '../../components';
import { PaletteIcon, SearchIcon } from '../../assets/icons';
import * as Icons from '../../assets/icons';
import { AVAILABLE_ACCENTS, AccentOption } from '../../stores/themeStore';
import { ClaudeMdCard } from './ClaudeMdCard';
import { InventoryCard } from './InventoryCard';

export const AssetsTab: React.FC = () => {
  const [iconSearch, setIconSearch] = useState('');

  // Extract all icon components exported from icons catalog
  const iconEntries = Object.entries(Icons).filter(([name]) => name.endsWith('Icon'));

  const filteredIcons = iconEntries.filter(([name]) =>
    name.toLowerCase().includes(iconSearch.toLowerCase())
  );

  return (
    <div className="view-list">
      <InventoryCard
        path="src/ui/assets"
        items={[
          { name: 'styles/', note: 'six stylesheets, one per cascade layer (reset → overlays); tokens in variables.css' },
          { name: 'icons/', note: `${iconEntries.length} semantic icons in the catalog, re-exported from lucide-react` },
          { name: 'fonts/', note: 'Inter + JetBrains Mono, self-hosted via @fontsource — no network at runtime' },
          { name: 'images/', note: 'empty so far — images import as Vite modules when added' },
        ]}
      />

      <Card
        title="Accent Pigments"
        subtitle="AVAILABLE_ACCENTS in themeStore.ts — hover/subtle shades derive in CSS"
        icon={<PaletteIcon size={20} />}
        action={<Badge variant="neutral">{AVAILABLE_ACCENTS.length}</Badge>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          {AVAILABLE_ACCENTS.map((accent: AccentOption) => (
            <div
              key={accent.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: accent.color,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: '0.929rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {accent.name}
                </div>
                <div style={{ fontSize: '0.786rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {accent.color}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Icon Catalog"
        subtitle="Everything exported from icons/index.ts — import from here, not lucide-react"
        icon={<SearchIcon size={20} />}
        action={<Badge variant="neutral">{filteredIcons.length}/{iconEntries.length}</Badge>}
      >
        <Form.Row label="Search" description="Filter by semantic name">
          <Form.Input
            icon={<SearchIcon size={14} />}
            value={iconSearch}
            onChange={(e) => setIconSearch(e.target.value)}
            placeholder="Search icon name..."
          />
        </Form.Row>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: '8px',
            maxHeight: '280px',
            overflowY: 'auto',
            paddingRight: '4px',
          }}
        >
          {filteredIcons.map(([name, IconComponent]: [string, any]) => (
            <div
              key={name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 8px',
                backgroundColor: 'var(--bg-app)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                gap: '6px',
                textAlign: 'center',
              }}
            >
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <IconComponent size={20} />
              </span>
              <span
                style={{
                  fontSize: '0.786rem',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  wordBreak: 'break-all',
                }}
              >
                {name.replace('Icon', '')}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <ClaudeMdCard dir="assets" />
    </div>
  );
};
