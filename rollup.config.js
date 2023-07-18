// rollup.config.js
import dts from 'rollup-plugin-dts'

export default [{
  input: "./lib/main.ts",
  output: [{ file: "dist/stats-gl.d.ts", format: "es" }],
  plugins: [dts()]
}]
