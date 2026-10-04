import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '@tailwindcss/node';
import postcss, { type Root, type Rule } from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

const rootDirectory = resolve(__dirname, '../..');
let generated: Root;

function declaration(selector: string, property: string) {
  let result: { value: string; important: boolean } | undefined;
  generated.walkRules(rule => {
    if (rule.selector !== selector) return;
    rule.walkDecls(property, item => {
      if (!result?.important || item.important) {
        result = { value: item.value, important: Boolean(item.important) };
      }
    });
  });
  return result;
}

function ancestorMedia(rule: Rule): string[] {
  const conditions: string[] = [];
  for (let parent: Rule['parent'] | Root['parent'] = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'media') conditions.push(parent.params);
  }
  return conditions;
}

beforeAll(async () => {
  const compiler = await compile(readFileSync(resolve(rootDirectory, 'index.css'), 'utf8'), {
    base: rootDirectory,
    onDependency: () => {},
  });
  generated = postcss.parse(compiler.build([
    'animate-in', 'fade-in', 'zoom-in-95', 'slide-in-from-bottom-4',
    'dialog-motion', 'dialog-transition', 'motion-safe:dialog-transition',
    'bg-slate-900', 'shadow', 'shadow-sm', 'rounded', 'backdrop-blur-sm',
    'outline-none', 'focus:outline-none', 'flex-shrink-0',
    'group-hover:grid', 'group-hover:opacity-100',
  ]));
});

describe('Tailwind CSS compiled for the app', () => {
  it('emits the animation plugin effects and keeps dialog motion on its own clock', () => {
    expect(declaration('.animate-in', 'animation-name')?.value).toBe('enter');
    expect(declaration('.fade-in', '--tw-enter-opacity')?.value).toBe('0');
    expect(declaration('.zoom-in-95', '--tw-enter-scale')?.value).toBe('.95');
    expect(declaration('.slide-in-from-bottom-4', '--tw-enter-translate-y')?.value).toBe('1rem');
    expect(declaration('.dialog-motion', 'animation-duration')).toEqual({ value: '320ms', important: true });
    expect(declaration('.dialog-motion', 'animation-timing-function')?.value).toBe('cubic-bezier(0.32, 0.72, 0.24, 1)');
    expect(declaration('.dialog-transition', 'transition-duration')).toEqual({ value: '320ms', important: true });
    expect(declaration('.motion-safe\\:dialog-transition', 'transition-duration')).toEqual({ value: '320ms', important: true });
  });

  it('retains the palette and control sizes already used by the app', () => {
    expect(declaration(':root, :host', '--color-slate-900')?.value).toBe('#0f172a');
    expect(declaration('.shadow', '--tw-shadow')?.value).toBe('0 1px 3px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 1px 2px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1))');
    expect(declaration('.shadow-sm', '--tw-shadow')?.value).toBe('0 1px 2px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.05))');
    expect(declaration('.rounded', 'border-radius')?.value).toBe('0.25rem');
    expect(declaration(':root, :host', '--blur-sm')?.value).toBe('4px');
    expect(declaration('.backdrop-blur-sm', '--tw-backdrop-blur')?.value).toBe('blur(var(--blur-sm))');
    expect(declaration('.flex-shrink-0', 'flex-shrink')?.value).toBe('0');
  });

  it('keeps transparent outlines visible in forced colors for bare and focused controls', () => {
    for (const selector of ['.outline-none', '.focus\\:outline-none:focus']) {
      expect(declaration(selector, 'outline')?.value).toBe('2px solid transparent');
      expect(declaration(selector, 'outline-offset')?.value).toBe('2px');
      expect(declaration(selector, 'outline-style')).toEqual({ value: 'solid', important: true });
    }
  });

  it('emits hover reveal controls without restricting them to hover-capable devices', () => {
    const reveals: Array<{ property: string; value: string; media: string[] }> = [];
    generated.walkRules(rule => {
      if (!rule.selector.startsWith('.group-hover\\:')) return;
      rule.walkDecls(item => {
        reveals.push({ property: item.prop, value: item.value, media: ancestorMedia(rule) });
      });
    });
    expect(reveals).toEqual([
      { property: 'display', value: 'grid', media: [] },
      { property: 'opacity', value: '100%', media: [] },
    ]);
  });
});
