class Panel {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D | null;
    name: string;
    fg: string;
    bg: string;
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
        this.PR = Math.round( window.devicePixelRatio || 1 );
        
        this.WIDTH = 90 * this.PR;
        this.HEIGHT = 48 * this.PR;
        this.TEXT_X = 3 * this.PR;
        this.TEXT_Y = 2 * this.PR;
        this.GRAPH_X = 3 * this.PR;
        this.GRAPH_Y = 15 * this.PR;
        this.GRAPH_WIDTH = 84 * this.PR;
        this.GRAPH_HEIGHT = 30 * this.PR;

        this.canvas = document.createElement('canvas');
        this.canvas.width = 90 * this.PR;
        this.canvas.height = 48 * this.PR;
        this.canvas.style.width = '90px';
        this.canvas.style.position = 'absolute';
        this.canvas.style.height = '48px';
        this.canvas.style.cssText = 'width:90px;height:48px';

        this.context = this.canvas.getContext('2d');

        if (this.context) {
            this.context.font = 'bold ' + (9 * this.PR) + 'px Helvetica,Arial,sans-serif';
            this.context.textBaseline = 'top';

            this.context.fillStyle = this.bg;
            this.context.fillRect(0, 0, this.WIDTH, this.HEIGHT);

            this.context.fillStyle = this.fg;
            this.context.fillText(this.name, this.TEXT_X, this.TEXT_Y);
            this.context.fillRect(this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH, this.GRAPH_HEIGHT);

            this.context.fillStyle = this.bg;
            this.context.globalAlpha = 0.9;
            this.context.fillRect(this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH, this.GRAPH_HEIGHT);
        }

    }

    update(value: number, valueGraph: number, maxValue: number, maxGraph: number, decimals = 0) {
        let min = Infinity, max = 0;

        if (!this.context) return;

        min = Math.min(min, value);
        max = Math.max(maxValue, value);
        maxGraph = Math.max(maxGraph, valueGraph);

        this.context.fillStyle = this.bg;
        this.context.globalAlpha = 1;
        this.context.fillRect(0, 0, this.WIDTH, this.GRAPH_Y);
        this.context.fillStyle = this.fg;
        this.context.fillText(value.toFixed(decimals) + ' ' + this.name + ' (' + min.toFixed(decimals) + '-' + parseFloat(max.toFixed(decimals)) + ')', this.TEXT_X, this.TEXT_Y);

        this.context.drawImage(this.canvas, this.GRAPH_X + this.PR, this.GRAPH_Y, this.GRAPH_WIDTH - this.PR, this.GRAPH_HEIGHT, this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH - this.PR, this.GRAPH_HEIGHT);

        this.context.fillRect(this.GRAPH_X + this.GRAPH_WIDTH - this.PR, this.GRAPH_Y, this.PR, this.GRAPH_HEIGHT);

        this.context.fillStyle = this.bg;
        this.context.globalAlpha = 0.9;

        this.context.fillRect(this.GRAPH_X + this.GRAPH_WIDTH - this.PR, this.GRAPH_Y, this.PR, ((1 - (valueGraph / maxGraph))) * this.GRAPH_HEIGHT);
    }
};

export default Panel;