import { describe, it, expect } from "vitest";
import { parseRssXml, normalizeRss } from "./rss";

const rss = `<?xml version="1.0"?><rss><channel>
  <item>
    <title><![CDATA[GPT-X released]]></title>
    <link>https://news.example.com/gpt-x</link>
    <description><![CDATA[<p>A <b>big</b> model drop with new tools.</p>]]></description>
    <pubDate>Wed, 24 Jun 2026 08:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?><feed>
  <entry>
    <title>Atom item</title>
    <link href="https://atom.example.com/a" />
    <summary>Short summary</summary>
    <updated>2026-06-24T08:00:00Z</updated>
  </entry>
</feed>`;

describe("parseRssXml", () => {
  it("parses RSS items, unwraps CDATA, strips HTML from description", () => {
    const out = parseRssXml(rss);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("GPT-X released");
    expect(out[0].link).toBe("https://news.example.com/gpt-x");
    expect(out[0].description).toBe("A big model drop with new tools.");
    expect(out[0].pubDate).toBe("Wed, 24 Jun 2026 08:00:00 GMT");
  });

  it("parses Atom entries with href links and summary", () => {
    const out = parseRssXml(atom);
    expect(out[0].title).toBe("Atom item");
    expect(out[0].link).toBe("https://atom.example.com/a");
    expect(out[0].description).toBe("Short summary");
  });
});

describe("normalizeRss", () => {
  it("maps to NewsItem with the given category and ISO publishedAt", () => {
    const out = normalizeRss(rss, "ai");
    expect(out[0]).toMatchObject({
      title: "GPT-X released",
      url: "https://news.example.com/gpt-x",
      category: "ai",
    });
    expect(out[0].publishedAt).toBe(new Date("Wed, 24 Jun 2026 08:00:00 GMT").toISOString());
    expect(out[0].source).toBe("news.example.com");
  });
});
