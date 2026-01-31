import { Panel } from './panel';

class PanelTexture extends Panel {
  private currentBitmap: ImageBitmap | null = null;
  private sourceAspect: number = 1; // Source texture aspect ratio (width/height)

  constructor(name: string) {
    super(name, '#fff', '#111');
    this.initializeCanvas();
  }

  public override initializeCanvas() {
    if (!this.context) return;

    this.context.imageSmoothingEnabled = true;
    this.context.font = 'bold ' + (9 * this.PR) + 'px Helvetica,Arial,sans-serif';
    this.context.textBaseline = 'top';

    // Fill entire panel with black background for texture display
    this.context.fillStyle = '#000';
    this.context.fillRect(0, 0, this.WIDTH, this.HEIGHT);

    // Draw label overlay
    this.drawLabelOverlay();
  }

  private drawLabelOverlay(): void {
    if (!this.context) return;

    // Semi-transparent background for label
    this.context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.context.fillRect(0, 0, this.WIDTH, this.GRAPH_Y);

    // Draw label text
    this.context.fillStyle = this.fg;
    this.context.fillText(this.name, this.TEXT_X, this.TEXT_Y);
  }

  /**
   * Set the source texture aspect ratio for proper display
   * @param width - Source texture width
   * @param height - Source texture height
   */
  public setSourceSize(width: number, height: number): void {
    this.sourceAspect = width / height;
  }

  public updateTexture(bitmap: ImageBitmap): void {
    if (!this.context) return;

    // Close previous bitmap to release GPU resources
    if (this.currentBitmap) {
      this.currentBitmap.close();
    }
    this.currentBitmap = bitmap;

    // Clear entire panel
    this.context.fillStyle = '#000';
    this.context.fillRect(0, 0, this.WIDTH, this.HEIGHT);

    // Calculate destination rect maintaining aspect ratio for full panel
    const panelAspect = this.WIDTH / this.HEIGHT;
    let destWidth: number;
    let destHeight: number;
    let destX: number;
    let destY: number;

    if (this.sourceAspect > panelAspect) {
      // Source is wider than panel - fit to width, letterbox top/bottom
      destWidth = this.WIDTH;
      destHeight = this.WIDTH / this.sourceAspect;
      destX = 0;
      destY = (this.HEIGHT - destHeight) / 2;
    } else {
      // Source is taller than panel - fit to height, pillarbox left/right
      destHeight = this.HEIGHT;
      destWidth = this.HEIGHT * this.sourceAspect;
      destX = (this.WIDTH - destWidth) / 2;
      destY = 0;
    }

    // Draw the bitmap with proper aspect ratio
    this.context.drawImage(
      bitmap,
      destX,
      destY,
      destWidth,
      destHeight
    );

    // Draw label overlay on top
    this.drawLabelOverlay();
  }

  public setLabel(label: string): void {
    this.name = label;
    // Redraw label overlay with new name
    this.drawLabelOverlay();
  }

  // Override update - not used for texture panels
  public override update(_value: number, _maxValue: number, _decimals: number = 0, _suffix: string = ''): void {
    // No-op for texture panels
  }

  // Override updateGraph - not used for texture panels
  public override updateGraph(_valueGraph: number, _maxGraph: number): void {
    // No-op for texture panels
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    if (this.currentBitmap) {
      this.currentBitmap.close();
      this.currentBitmap = null;
    }
  }
}

export { PanelTexture };
