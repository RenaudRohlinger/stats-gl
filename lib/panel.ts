class Panel {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D | null;
    name: string;
    fg: string;
    bg: string;
    gradient: CanvasGradient | null;
    id: number = 0;
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
        this.PR = Math.round(window.devicePixelRatio || 1);

        this.WIDTH = 90 * this.PR;
        this.HEIGHT = 48 * this.PR;
        this.TEXT_X = 3 * this.PR;
        this.TEXT_Y = 2 * this.PR;
        this.GRAPH_X = 3 * this.PR;
        this.GRAPH_Y = 15 * this.PR;
        this.GRAPH_WIDTH = 84 * this.PR;
        this.GRAPH_HEIGHT = 30 * this.PR;

        this.canvas = document.createElement('canvas');
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

        let startColor: string;
        const endColor: string = this.fg;

        switch (this.fg.toLowerCase()) {
            case '#0ff':
                startColor = '#006666';
                break;
            case '#0f0':
                startColor = '#006600';
                break;
            case '#ff0':
                startColor = '#666600';
                break;
            case '#e1e1e1':
                startColor = '#666666';
                break;
            default:
                startColor = this.bg;
                break;
        }

        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);

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
    public update(value: number, maxValue: number, decimals: number = 0) {
        if (!this.context || !this.gradient) return;

        const min = Math.min(Infinity, value);
        const max = Math.max(maxValue, value);

        // Clear only the text area (from top to GRAPH_Y)
        this.context.globalAlpha = 1;
        this.context.fillStyle = this.bg;
        this.context.fillRect(0, 0, this.WIDTH, this.GRAPH_Y);

        // Draw text
        this.context.fillStyle = this.fg;
        this.context.fillText(
            `${value.toFixed(decimals)} ${this.name} (${min.toFixed(decimals)}-${parseFloat(max.toFixed(decimals))})`,
            this.TEXT_X,
            this.TEXT_Y
        );
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

export { Panel };