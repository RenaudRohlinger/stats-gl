import { Panel } from './panel';

/**
 * Memory panel. Values fed to update()/updateGraph() are megabytes;
 * the text renders adaptively as MB or GB.
 */
class PanelMemory extends Panel {
  public override update(value: number, maxValue: number, _decimals: number = 0, suffix: string = '', minValue: number = value) {
    const min = Math.min(minValue, value);
    const max = Math.max(maxValue, value);

    this.drawText(
      `${formatMB(value)} ${this.name}`,
      ` (${formatMB(min)}-${formatMB(max)})`,
      suffix
    );
  }
}

function formatMB(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)}G`;
  }
  return `${mb.toFixed(mb < 10 ? 1 : 0)}M`;
}

export { PanelMemory };
