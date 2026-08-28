interface ArtworkProps {
  className?: string;
}

const artworkAccessibility = {
  "aria-hidden": true,
  focusable: false,
  role: "presentation",
} as const;

export function CommunityHeroArtwork({ className = "" }: ArtworkProps) {
  return (
    <img
      src="/community/community-hero-v2.jpg"
      alt=""
      className={className}
      aria-hidden="true"
      decoding="async"
      draggable={false}
      fetchPriority="high"
    />
  );
}

export function DiscussionCtaArtwork({ className = "" }: ArtworkProps) {
  return (
    <img
      src="/community/community-cta-v2.jpg"
      alt=""
      className={className}
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  );
}

export function DiscussionEmptyArtwork({ className = "" }: ArtworkProps) {
  return (
    <img
      src="/community/community-empty-v2.jpg"
      alt=""
      className={className}
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  );
}

/** Low-contrast manufacturing silhouettes finish the page without adding visual weight. */
export function IndustrialSkyline({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 1200 100" preserveAspectRatio="none" className={className} {...artworkAccessibility}>
      <defs>
        <linearGradient id="communitySkylinePurple" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#A78BFA" stopOpacity=".18" />
          <stop offset="1" stopColor="#7C3AED" stopOpacity=".08" />
        </linearGradient>
        <linearGradient id="communitySkylineOrange" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FB923C" stopOpacity=".16" />
          <stop offset="1" stopColor="#F97316" stopOpacity=".06" />
        </linearGradient>
      </defs>
      <path d="M0 91h1200v9H0z" fill="#7C3AED" opacity=".055" />
      <path d="M0 94 160 76l144 12 146-18 160 18 152-13 146 13 145-18 147 15v15H0Z" fill="#8B5CF6" opacity=".035" />

      <g fill="url(#communitySkylinePurple)">
        <path d="M24 92V62l43 17V55l47 20V45l66 30v17H24Z" />
        <path d="M464 92V63h89V50h23v42H464Zm24-29V43h65v20" />
        <path d="M771 92V63l42 17V56l47 20V46l66 30v16H771Z" />
      </g>
      <g fill="#7C3AED" opacity=".13">
        <rect x="43" y="79" width="13" height="8" rx="2" />
        <rect x="68" y="79" width="13" height="8" rx="2" />
        <rect x="93" y="79" width="13" height="8" rx="2" />
        <rect x="118" y="79" width="13" height="8" rx="2" />
        <rect x="791" y="79" width="13" height="8" rx="2" />
        <rect x="816" y="79" width="13" height="8" rx="2" />
        <rect x="841" y="79" width="13" height="8" rx="2" />
        <rect x="866" y="79" width="13" height="8" rx="2" />
      </g>

      <g fill="url(#communitySkylineOrange)">
        <path d="M221 69h107v23H221z" />
        <path d="m234 69 16-19h42l21 19Z" />
        <circle cx="247" cy="92" r="10" />
        <circle cx="301" cy="92" r="10" />
        <path d="M984 69h107v23H984z" />
        <path d="m997 69 16-19h42l21 19Z" />
        <circle cx="1010" cy="92" r="10" />
        <circle cx="1064" cy="92" r="10" />
        <path d="M1120 92V53h20V34h20v58h18V66h20v26Z" />
      </g>

      <g transform="translate(668 72)" fill="#F97316" opacity=".11">
        <circle r="21" />
        <circle r="9" fill="#FFFFFF" />
        <rect x="-5" y="-35" width="10" height="15" rx="4" />
        <rect x="-5" y="20" width="10" height="15" rx="4" />
        <rect x="20" y="-5" width="15" height="10" rx="4" />
        <rect x="-35" y="-5" width="15" height="10" rx="4" />
        <rect x="14" y="-29" width="10" height="15" rx="4" transform="rotate(45 19 -21.5)" />
        <rect x="-24" y="14" width="10" height="15" rx="4" transform="rotate(45 -19 21.5)" />
      </g>
    </svg>
  );
}
