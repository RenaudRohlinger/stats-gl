class Panel {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D | null;
    name: string;
    fg: string;
    bg: string;
    gradient: CanvasGradient | null;
    id: number = 0;
    /** Smoothed display value, maintained by Stats at text-update cadence */
    emaValue: number | null = null;
    PR: number;
    WIDTH: number;
    HEIGHT: number;
    TEXT_X: number;
    TEXT_Y: number;
    GRAPH_X: number;
    GRAPH_Y: number;
    GRAPH_WIDTH: number;
    GRAPH_HEIGHT: number;

    constructor(name: string, fg: string, bg: string) {
        this.name = name;
        this.fg = fg;
        this.bg = bg;
        this.gradient = null;
        this.PR = Math.round(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);

        this.WIDTH = 90 * this.PR;
        this.HEIGHT = 48 * this.PR;
        this.TEXT_X = 3 * this.PR;
        this.TEXT_Y = 2 * this.PR;
        this.GRAPH_X = 3 * this.PR;
        this.GRAPH_Y = 15 * this.PR;
        this.GRAPH_WIDTH = 84 * this.PR;
        this.GRAPH_HEIGHT = 30 * this.PR;

        this.canvas = typeof document !== 'undefined'
            ? document.createElement('canvas')
            : new OffscreenCanvas(this.WIDTH, this.HEIGHT) as unknown as HTMLCanvasElement;
        this.canvas.width = this.WIDTH;
        this.canvas.height = this.HEIGHT;
        this.canvas.style.width = '90px';
        this.canvas.style.height = '48px';
        this.canvas.style.position = 'absolute';
        this.canvas.style.cssText = 'width:90px;height:48px;background-color: transparent !important;';

        this.context = this.canvas.getContext('2d');

        this.initializeCanvas();
    }

    private createGradient(): CanvasGradient {
        if (!this.context) throw new Error('No context');

        const gradient = this.context.createLinearGradient(
            0,
            this.GRAPH_Y,
            0,
            this.GRAPH_Y + this.GRAPH_HEIGHT
        );

        // Darkened foreground as the gradient start so any panel color works
        gradient.addColorStop(0, darkenColor(this.fg, 0.4) ?? this.bg);
        gradient.addColorStop(1, this.fg);

        return gradient;
    }

    public initializeCanvas() {
        if (!this.context) return;

        this.context.imageSmoothingEnabled = false;

        this.context.font = 'bold ' + (9 * this.PR) + 'px Helvetica,Arial,sans-serif';
        this.context.textBaseline = 'top';

        this.gradient = this.createGradient();

        this.context.fillStyle = this.bg;
        this.context.fillRect(0, 0, this.WIDTH, this.HEIGHT);

        this.context.fillStyle = this.fg;
        this.context.fillText(this.name, this.TEXT_X, this.TEXT_Y);


        this.context.fillStyle = this.bg;
        this.context.globalAlpha = 0.9;
        this.context.fillRect(this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH, this.GRAPH_HEIGHT);
    }

    // Update only text portion
    public update(value: number, maxValue: number, decimals: number = 0, suffix: string = '', minValue: number = value) {
        const min = Math.min(minValue, value);
        const max = Math.max(maxValue, value);

        this.drawText(
            `${value.toFixed(decimals)} ${this.name}`,
            ` (${parseFloat(min.toFixed(decimals))}-${parseFloat(max.toFixed(decimals))})`,
            suffix
        );
    }

    protected drawText(valueAndName: string, rangeText: string, suffix: string = '') {
        if (!this.context || !this.gradient) return;

        // Clear only the text area (from top to GRAPH_Y)
        this.context.globalAlpha = 1;
        this.context.fillStyle = this.bg;
        this.context.fillRect(0, 0, this.WIDTH, this.GRAPH_Y);

        // Draw value and name
        this.context.fillStyle = this.fg;
        this.context.fillText(valueAndName, this.TEXT_X, this.TEXT_Y);

        let textX = this.TEXT_X + this.context.measureText(valueAndName).width;

        // Draw suffix in orange if present
        if (suffix) {
            this.context.fillStyle = '#f90';
            this.context.fillText(suffix, textX, this.TEXT_Y);
            textX += this.context.measureText(suffix).width;
        }

        // Draw range
        this.context.fillStyle = this.fg;
        this.context.fillText(rangeText, textX, this.TEXT_Y);
    }

    // Update only graph portion
    public updateGraph(valueGraph: number, maxGraph: number) {
        if (!this.context || !this.gradient) return;

        // Handle zero values appropriately
        if (valueGraph === 0 && maxGraph === 0) {
            maxGraph = 1; // Prevent division by zero
        }

        // Ensure maxGraph is valid and values are positive
        maxGraph = Math.max(maxGraph, valueGraph, 0.1);
        valueGraph = Math.max(valueGraph, 0);

        // Ensure all coordinates are rounded to avoid sub-pixel rendering
        const graphX = Math.round(this.GRAPH_X);
        const graphY = Math.round(this.GRAPH_Y);
        const graphWidth = Math.round(this.GRAPH_WIDTH);
        const graphHeight = Math.round(this.GRAPH_HEIGHT);
        const pr = Math.round(this.PR);

        // Shift the graph left
        this.context.drawImage(
            this.canvas,
            graphX + pr,
            graphY,
            graphWidth - pr,
            graphHeight,
            graphX,
            graphY,
            graphWidth - pr,
            graphHeight
        );

        // Clear only the new column area
        this.context.fillStyle = this.bg;
        this.context.fillRect(
            graphX + graphWidth - pr,
            graphY,
            pr,
            graphHeight
        );

        // Calculate column height
        const columnHeight = Math.min(
            graphHeight,
            Math.round(valueGraph / maxGraph * graphHeight)
        );

        // Draw the gradient column
        if (columnHeight > 0) {
            this.context.globalAlpha = 0.9;
            this.context.fillStyle = this.gradient;
            this.context.fillRect(
                graphX + graphWidth - pr,
                graphY + (graphHeight - columnHeight),
                pr,
                columnHeight
            );
        }

        this.context.globalAlpha = 1;
    }
}

/**
 * Darken a #rgb/#rrggbb color by the given factor. Returns null for
 * unparseable input (e.g. named or rgba() colors) so callers can fall back.
 */
function darkenColor(color: string, factor: number): string | null {
    if (color[0] !== '#') return null;

    let hex = color.slice(1);
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length !== 6) return null;

    const rgb = parseInt(hex, 16);
    if (Number.isNaN(rgb)) return null;

    const r = Math.round(((rgb >> 16) & 0xff) * factor);
    const g = Math.round(((rgb >> 8) & 0xff) * factor);
    const b = Math.round((rgb & 0xff) * factor);

    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export { Panel };