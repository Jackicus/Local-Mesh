import React from 'react';
import { Card, Badge, Form } from '../../components';
import {
  PaletteIcon,
  SunIcon,
  MoonIcon,
  SystemIcon,
  CheckIcon,
  TypeIcon,
} from '../../assets/icons';
import { useTheme, AVAILABLE_ACCENTS, FontFamily, FontSize } from '../../stores/themeStore';

export const AppearanceTab: React.FC = () => {
  const [themeState, themeActions] = useTheme();

  const activeAccentObj = AVAILABLE_ACCENTS.find((a) => a.id === themeState.accent);

  const getModeLabel = () => {
    switch (themeState.mode) {
      case 'system':
        return 'System';
      case 'light':
        return 'Light';
      case 'dark':
        return 'Dark';
    }
  };

  return (
    <div className="view-list">
      {/* 1. Theme Mode & Colors */}
      <Card
        title="Theme &amp; Accent"
        subtitle="Manage color scheme and interactive brand tones"
        icon={<PaletteIcon size={20} />}
        action={
          <Badge variant="accent">
            {getModeLabel()} • {activeAccentObj?.name}
          </Badge>
        }
      >
        {/* Row 1: Appearance Mode */}
        <Form.Row
          label="Appearance Mode"
          description="Select light, dark, or follow system desktop theme"
        >
          <Form.Segmented
            value={themeState.mode}
            onChange={themeActions.setMode}
            options={[
              {
                value: 'system',
                label: 'System',
                icon: <SystemIcon size={14} />,
              },
              {
                value: 'light',
                label: 'Light',
                icon: <SunIcon size={14} />,
              },
              {
                value: 'dark',
                label: 'Dark',
                icon: <MoonIcon size={14} />,
              },
            ]}
          />
        </Form.Row>

        {/* Row 2: Accent Color */}
        <Form.Row
          label="Accent Color"
          description="Choose the active brand tint and interactive highlight color"
        >
          <div className="accent-square-row">
            {AVAILABLE_ACCENTS.map((accent) => {
              const isSelected = themeState.accent === accent.id;
              return (
                <button
                  key={accent.id}
                  type="button"
                  className={`accent-square-btn ${isSelected ? 'selected' : ''}`}
                  onClick={() => themeActions.setAccent(accent.id)}
                  style={{ backgroundColor: accent.color }}
                  title={accent.name}
                  aria-label={accent.name}
                >
                  {isSelected && <CheckIcon size={14} color="#ffffff" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </Form.Row>
      </Card>

      {/* 2. Typography & Font Selection */}
      <Card
        title="Typography"
        subtitle="Interface font family and readability sizing"
        icon={<TypeIcon size={20} />}
      >
        <Form.Row
          label="Font Family"
          description="Select the typeface used across application screens"
        >
          <Form.Select
            value={themeState.fontFamily}
            onChange={(e) => themeActions.setFontFamily(e.target.value as FontFamily)}
            options={[
              { value: 'system', label: 'System Default (Segoe / San Francisco)' },
              { value: 'inter', label: 'Inter (Modern Sans-Serif)' },
              { value: 'mono', label: 'JetBrains Mono (Monospace)' },
            ]}
          />
        </Form.Row>

        <Form.Row
          label="Base Font Scale"
          description="Adjust root text scaling for comfortable reading"
        >
          <Form.Segmented
            value={themeState.fontSize}
            onChange={(val) => themeActions.setFontSize(val as FontSize)}
            options={[
              { value: 'sm', label: 'Compact (13px)' },
              { value: 'md', label: 'Standard (14px)' },
              { value: 'lg', label: 'Comfortable (15px)' },
            ]}
          />
        </Form.Row>
      </Card>
    </div>
  );
};
