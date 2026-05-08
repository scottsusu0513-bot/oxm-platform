export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  content: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx !== -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, content: match[2] };
}

const modules = import.meta.glob('../content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const allPosts: BlogPost[] = Object.entries(modules)
  .map(([path, raw]) => {
    const slug = path.match(/\/([^/]+)\.md$/)?.[1] ?? '';
    const { meta, content } = parseFrontmatter(raw);
    return {
      slug,
      title: meta.title ?? '',
      description: meta.description ?? '',
      date: meta.date ?? '',
      content,
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

export function getPost(slug: string): BlogPost | undefined {
  return allPosts.find((p) => p.slug === slug);
}
