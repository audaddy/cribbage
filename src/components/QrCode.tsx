import qr from "qrcode-generator";

/**
 * A join link as a QR code, drawn as one SVG path.
 *
 * Rendered on the server into plain markup: a television is often a browser
 * nobody has updated in years, and a static path is the one thing every one of
 * them can draw. One path rather than a rectangle per module keeps it small.
 */
export function QrCode({
  value,
  size = 220,
  title = "Scan to join",
}: {
  value: string;
  size?: number;
  title?: string;
}) {
  const code = qr(0, "M");
  code.addData(value);
  code.make();

  const count = code.getModuleCount();
  // A quiet border is part of the spec — without it scanners struggle.
  const quiet = 2;
  const span = count + quiet * 2;

  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) {
        path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#101318" />
    </svg>
  );
}
