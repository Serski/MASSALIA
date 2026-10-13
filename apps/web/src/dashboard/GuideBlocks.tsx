import type { GuideBlock } from "./guideContent.js";
import "./guideBlocks.css";

// A Guide section's richer blocks — headings, plain lines, lists and tables —
// for the in-game Guide sheet and the public /guides page alike. `textClass` is
// the surface's own paragraph class (guide-p / lobby-guide-p): the wrapper wears
// it, so type and color are the surface's and guideBlocks.css adds only layout.
export function GuideBlocks({ blocks, textClass }: { blocks: GuideBlock[] | undefined; textClass: string }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className={`guide-blocks ${textClass}`}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") return <h4 className="guide-block-h" key={index}>{block.text}</h4>;
        if (block.kind === "text") return <p key={index}>{block.text}</p>;
        if (block.kind === "list") {
          return (
            <ul className="guide-block-list" key={index}>
              {block.items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          );
        }
        const { caption, columns, rows } = block.table;
        return (
          <div className="guide-table-wrap" key={index}>
            <table className="guide-table">
              <caption>{caption}</caption>
              <thead>
                <tr>
                  {columns.map((column, c) => <th scope="col" key={c}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (c === 0 ? <th scope="row" key={c}>{cell}</th> : <td key={c}>{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
