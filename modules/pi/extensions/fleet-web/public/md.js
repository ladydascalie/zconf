// Tiny markdown renderer (headings, lists, tables, code, inline styles). No deps.

function esc(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s) {
	return esc(s)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|\W)\*([^*]+)\*/g, "$1<em>$2</em>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function renderMd(src) {
	const lines = String(src ?? "").split(/\r?\n/);
	const out = [];
	let i = 0;
	let list = null; // "ul" | "ol"

	const closeList = () => {
		if (list) {
			out.push(`</${list}>`);
			list = null;
		}
	};

	while (i < lines.length) {
		const line = lines[i];

		// fenced code
		if (/^```/.test(line)) {
			closeList();
			const buf = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
			i++;
			out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
			continue;
		}

		const h = line.match(/^(#{1,6})\s+(.*)/);
		if (h) {
			closeList();
			const lvl = Math.min(h[1].length, 4);
			out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
			i++;
			continue;
		}

		// table
		if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
			closeList();
			const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
			const headers = cells(line);
			i += 2;
			const rows = [];
			while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
			out.push("<table><thead><tr>" + headers.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
			continue;
		}

		const ul = line.match(/^\s*[-*+]\s+(.*)/);
		const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
		if (ul || ol) {
			const want = ul ? "ul" : "ol";
			if (list !== want) {
				closeList();
				out.push(`<${want}>`);
				list = want;
			}
			out.push(`<li>${inline((ul || ol)[1])}</li>`);
			i++;
			continue;
		}

		if (/^\s*>\s?/.test(line)) {
			closeList();
			const buf = [];
			while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
			out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
			continue;
		}

		if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
			closeList();
			out.push("<hr>");
			i++;
			continue;
		}

		if (!line.trim()) {
			closeList();
			i++;
			continue;
		}

		closeList();
		// paragraph: consume consecutive plain lines
		const buf = [line];
		i++;
		while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*\||\s*>\s?)/.test(lines[i])) buf.push(lines[i++]);
		out.push(`<p>${inline(buf.join(" "))}</p>`);
	}
	closeList();
	return out.join("\n");
}
