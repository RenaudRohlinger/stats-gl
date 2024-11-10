import { Panel } from './panel';

class PanelVSync extends Panel {
    private readonly SMALL_HEIGHT: number;
    private vsyncValue: number = 0;

    constructor(name: string, fg: string, bg: string) {
        super(name, fg, bg);

        // Redefine dimensions for a smaller panel
        this.SMALL_HEIGHT = 9 * this.PR; // Smaller height
        this.HEIGHT = this.SMALL_HEIGHT;
        this.WIDTH = 35 * this.PR; // Smaller width
        this.TEXT_Y = 0 * this.PR; // Adjust text position

        // Resize the canvas
        this.canvas.height = this.HEIGHT;
        this.canvas.width = this.WIDTH;
        this.canvas.style.height = '9px'; // Match the new height
        this.canvas.style.width = '35px'; // Match the new width
        // Style for overlay positioning
        this.canvas.style.cssText = `
            width: 35px;
            height: 9px;
            position: absolute;
            top: 0;
            left: 0;
            background-color: transparent !important;
            pointer-events: none;
        `;

        // Reinitialize with new dimensions
        this.initializeCanvas();
    }

    public initializeCanvas() {
        if (!this.context) return;

        this.context.imageSmoothingEnabled = false;

        // Larger font for better visibility
        this.context.font = 'bold ' + (9 * this.PR) + 'px Helvetica,Arial,sans-serif';
        this.context.textBaseline = 'top';
        this.context.globalAlpha = 1;
    }

    // Override update for VSync-specific display
    public update(value: number, _maxValue: number, _decimals: number = 0) {
        if (!this.context) return;

        this.vsyncValue = value;

        this.context.clearRect(0, 0, this.WIDTH, this.HEIGHT);
        // Draw VSync text
        this.context.globalAlpha = 1;
        this.context.fillStyle = this.bg;
        this.context.fillText(
            `${value.toFixed(0)}Hz`,
            this.TEXT_X,
            this.TEXT_Y
        );
    }

    // Override updateGraph to do nothing (we don't need a graph for VSync)
    public updateGraph(_valueGraph: number, _maxGraph: number) {
        // No graph needed for VSync display
        return;
    }

    // Method to set the offset position relative to parent panel
    public setOffset(x: number, y: number) {
        this.canvas.style.transform = `translate(${x}px, ${y}px)`;
    }
}

export { PanelVSync };