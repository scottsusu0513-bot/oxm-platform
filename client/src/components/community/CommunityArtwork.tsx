interface ArtworkProps {
  className?: string;
}

const artworkAccessibility = {
  "aria-hidden": true,
  focusable: false,
  role: "presentation",
} as const;

/** Two industry professionals exchanging ideas, in a clean flat-cartoon style. */
export function CommunityHeroArtwork({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 420 180" className={className} {...artworkAccessibility}>
      <defs>
        <filter id="communityHeroSoftShadow" x="-20%" y="-30%" width="140%" height="170%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#4C1D95" floodOpacity=".1" />
        </filter>
      </defs>

      {/* Quiet background colour blocks. */}
      <circle cx="354" cy="83" r="62" fill="#F5F0FF" />
      <circle cx="385" cy="124" r="24" fill="#FFF1E6" />
      <ellipse cx="219" cy="158" rx="163" ry="10" fill="#EDE9FE" opacity=".8" />

      {/* A single, recognisable factory silhouette. */}
      <g>
        <path d="M276 148v-50l25 14V91l27 15V84l34 20v44H276Z" fill="#DED2FF" />
        <rect x="362" y="92" width="27" height="56" rx="4" fill="#FFD8B8" />
        <rect x="369" y="101" width="13" height="5" rx="2.5" fill="#F97316" />
        <rect x="369" y="113" width="13" height="5" rx="2.5" fill="#F97316" />
        <rect x="369" y="125" width="13" height="5" rx="2.5" fill="#F97316" />
        <rect x="369" y="137" width="13" height="5" rx="2.5" fill="#F97316" />
        <g fill="#A78BFA">
          <rect x="287" y="121" width="13" height="10" rx="3" />
          <rect x="309" y="121" width="13" height="10" rx="3" />
          <rect x="331" y="121" width="13" height="10" rx="3" />
          <rect x="287" y="137" width="13" height="11" rx="3" />
          <rect x="309" y="137" width="13" height="11" rx="3" />
          <rect x="331" y="137" width="13" height="11" rx="3" />
        </g>
      </g>

      {/* Large speech bubbles stay legible at small sizes. */}
      <g filter="url(#communityHeroSoftShadow)">
        <path d="M49 25h92a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10H91L76 80l3-11H49a10 10 0 0 1-10-10V35a10 10 0 0 1 10-10Z" fill="#FFFFFF" stroke="#A78BFA" strokeWidth="2" />
        <rect x="57" y="40" width="51" height="4" rx="2" fill="#8B5CF6" />
        <rect x="57" y="51" width="72" height="4" rx="2" fill="#D8CCFF" />
        <circle cx="137" cy="41" r="3" fill="#F97316" />
      </g>
      <g filter="url(#communityHeroSoftShadow)">
        <path d="M231 20h84a10 10 0 0 1 10 10v25a10 10 0 0 1-10 10h-23l3 12-17-12h-47a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10Z" fill="#FFFFFF" stroke="#FB923C" strokeWidth="2" />
        <rect x="239" y="36" width="47" height="4" rx="2" fill="#F97316" />
        <rect x="239" y="47" width="66" height="4" rx="2" fill="#FED7AA" />
      </g>

      {/* Left professional. */}
      <g>
        <circle cx="146" cy="97" r="24" fill="#F4C7A5" />
        <path d="M122 96c0-18 9-28 25-28 14 0 23 10 23 26-12-8-28-10-43-3-1 2-3 4-5 5Z" fill="#26374B" />
        <circle cx="138" cy="98" r="2" fill="#334155" />
        <circle cx="155" cy="98" r="2" fill="#334155" />
        <path d="M139 107c5 4 10 4 15 0" fill="none" stroke="#B96F55" strokeWidth="2" strokeLinecap="round" />
        <path d="M109 140c2-23 16-35 37-35s35 12 38 35h-75Z" fill="#7C3AED" />
        <path d="m132 108 14 14 14-14-5 32h-19l-4-32Z" fill="#FFFFFF" />
        <path d="m132 108 14 14-10 8-9-18 5-4Zm28 0-14 14 9 8 10-18-5-4Z" fill="#9F67FF" />
        <circle cx="115" cy="135" r="7" fill="#F4C7A5" />
      </g>

      {/* Right professional. */}
      <g>
        <circle cx="232" cy="96" r="24" fill="#EDB991" />
        <path d="M208 94c0-17 10-27 25-27 16 0 24 11 24 28-11-8-27-11-43-4-2 1-4 2-6 3Z" fill="#65351F" />
        <circle cx="224" cy="97" r="2" fill="#334155" />
        <circle cx="241" cy="97" r="2" fill="#334155" />
        <path d="M225 106c5 4 10 4 15 0" fill="none" stroke="#A85F46" strokeWidth="2" strokeLinecap="round" />
        <path d="M195 140c3-23 16-35 37-35s35 12 38 35h-75Z" fill="#F97316" />
        <path d="m218 108 14 14 14-14-5 32h-19l-4-32Z" fill="#FFFFFF" />
        <path d="m218 108 14 14-10 8-9-18 5-4Zm28 0-14 14 9 8 10-18-5-4Z" fill="#FF9A4A" />
        <circle cx="263" cy="135" r="7" fill="#EDB991" />
      </g>

      {/* One simple shared table grounds the conversation. */}
      <rect x="91" y="134" width="190" height="17" rx="7" fill="#334155" />
      <rect x="108" y="149" width="6" height="18" rx="3" fill="#475569" />
      <rect x="258" y="149" width="6" height="18" rx="3" fill="#475569" />
      <rect x="174" y="127" width="28" height="7" rx="3.5" fill="#FFFFFF" />
    </svg>
  );
}

/** Publishing is represented by one document and one friendly conversation bubble. */
export function DiscussionCtaArtwork({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 190 104" className={className} {...artworkAccessibility}>
      <defs>
        <filter id="communityCtaSoftShadow" x="-25%" y="-30%" width="150%" height="170%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#4C1D95" floodOpacity=".12" />
        </filter>
      </defs>
      <circle cx="47" cy="65" r="30" fill="#FFF1E6" />
      <ellipse cx="101" cy="95" rx="72" ry="6" fill="#EDE9FE" />
      <g filter="url(#communityCtaSoftShadow)">
        <rect x="49" y="13" width="76" height="80" rx="10" fill="#FFFFFF" stroke="#C4B5FD" strokeWidth="2" />
        <rect x="49" y="13" width="76" height="17" rx="10" fill="#7C3AED" />
        <rect x="49" y="24" width="76" height="7" fill="#7C3AED" />
        <rect x="63" y="43" width="46" height="5" rx="2.5" fill="#C4B5FD" />
        <rect x="63" y="56" width="35" height="5" rx="2.5" fill="#E1D8FF" />
        <rect x="63" y="69" width="42" height="5" rx="2.5" fill="#E1D8FF" />
      </g>
      <g filter="url(#communityCtaSoftShadow)">
        <path d="M124 28h47a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10h-16l-14 11 3-11h-20a10 10 0 0 1-10-10V38a10 10 0 0 1 10-10Z" fill="#F97316" />
        <circle cx="135" cy="50" r="3" fill="#FFFFFF" />
        <circle cx="148" cy="50" r="3" fill="#FFFFFF" />
        <circle cx="161" cy="50" r="3" fill="#FFFFFF" />
      </g>
      <g transform="rotate(-38 124 78)">
        <rect x="118" y="63" width="12" height="34" rx="6" fill="#8B5CF6" />
        <path d="m118 63 6-9 6 9" fill="#F4C7A5" />
      </g>
    </svg>
  );
}

/** A friendly character searching an empty discussion board for the first topic. */
export function DiscussionEmptyArtwork({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 260 154" className={className} {...artworkAccessibility}>
      <defs>
        <filter id="communityEmptySoftShadow" x="-25%" y="-30%" width="150%" height="180%">
          <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#4C1D95" floodOpacity=".1" />
        </filter>
      </defs>
      <circle cx="203" cy="72" r="48" fill="#FFF3E8" />
      <ellipse cx="132" cy="143" rx="103" ry="8" fill="#EDE9FE" />

      {/* Clear, uncluttered discussion board. */}
      <g filter="url(#communityEmptySoftShadow)">
        <rect x="91" y="15" width="132" height="94" rx="12" fill="#FFFFFF" stroke="#C4B5FD" strokeWidth="2" />
        <path d="M103 15h108a12 12 0 0 1 12 12v5H91v-5a12 12 0 0 1 12-12Z" fill="#7C3AED" />
        <rect x="109" y="50" width="73" height="6" rx="3" fill="#D8CCFF" />
        <rect x="109" y="66" width="53" height="6" rx="3" fill="#E9E3FF" />
        <circle cx="195" cy="66" r="17" fill="#FFF1E6" />
        <path d="M190 61c0-4 3-7 7-7s7 3 7 7c0 6-6 6-6 11" fill="none" stroke="#F97316" strokeWidth="3" strokeLinecap="round" />
        <circle cx="198" cy="78" r="2" fill="#F97316" />
      </g>

      {/* Friendly flat-cartoon person. */}
      <g>
        <circle cx="66" cy="86" r="24" fill="#F4C7A5" />
        <path d="M42 84c0-18 10-28 25-28 14 0 24 10 24 26-12-8-28-10-44-3-1 2-3 4-5 5Z" fill="#26374B" />
        <circle cx="58" cy="87" r="2" fill="#334155" />
        <circle cx="75" cy="87" r="2" fill="#334155" />
        <path d="M59 96c5 4 10 4 15 0" fill="none" stroke="#B96F55" strokeWidth="2" strokeLinecap="round" />
        <path d="M27 138c3-25 17-38 39-38 23 0 38 13 41 38H27Z" fill="#7C3AED" />
        <path d="m51 104 15 16 15-16-6 34H57l-6-34Z" fill="#FFFFFF" />
        <path d="M99 122c16-7 29-15 39-24" fill="none" stroke="#7C3AED" strokeWidth="12" strokeLinecap="round" />
        <circle cx="139" cy="97" r="7" fill="#F4C7A5" />
      </g>

      {/* One bold magnifier replaces the previous small technical linework. */}
      <g transform="translate(164 98)">
        <circle r="19" fill="#FFFFFF" stroke="#8B5CF6" strokeWidth="6" />
        <circle r="8" fill="#FFF1E6" />
        <path d="m14 14 16 16" stroke="#8B5CF6" strokeWidth="8" strokeLinecap="round" />
      </g>
      <circle cx="229" cy="38" r="15" fill="#F97316" />
      <path d="M229 30v9" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
      <circle cx="229" cy="44" r="2" fill="#FFFFFF" />
    </svg>
  );
}

/** Low-contrast filled silhouettes: recognisable manufacturing, no technical line drawing. */
export function IndustrialSkyline({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 1200 100" preserveAspectRatio="none" className={className} {...artworkAccessibility}>
      <path d="M0 92h1200v8H0z" fill="#7C3AED" opacity=".06" />
      <path d="M25 92V61l39 17V55l43 18V45l62 29v18H25Z" fill="#8B5CF6" opacity=".1" />
      <g fill="#7C3AED" opacity=".12">
        <rect x="41" y="78" width="12" height="9" rx="2" />
        <rect x="64" y="78" width="12" height="9" rx="2" />
        <rect x="87" y="78" width="12" height="9" rx="2" />
        <rect x="110" y="78" width="12" height="9" rx="2" />
      </g>
      <g fill="#F97316" opacity=".1">
        <path d="M216 69h103v23H216z" />
        <path d="m229 69 15-19h41l20 19Z" />
        <circle cx="242" cy="92" r="10" />
        <circle cx="293" cy="92" r="10" />
      </g>
      <path d="M468 92V63h82V51h21v41H468Zm21-29V45h61v18" fill="#8B5CF6" opacity=".08" />
      <g transform="translate(666 72)" fill="#F97316" opacity=".1">
        <circle r="20" />
        <circle r="8" fill="#FFFFFF" />
        <rect x="-5" y="-33" width="10" height="14" rx="4" />
        <rect x="-5" y="19" width="10" height="14" rx="4" />
        <rect x="19" y="-5" width="14" height="10" rx="4" />
        <rect x="-33" y="-5" width="14" height="10" rx="4" />
      </g>
      <path d="M775 92V62l38 16V56l43 18V46l61 29v17H775Z" fill="#8B5CF6" opacity=".1" />
      <g fill="#7C3AED" opacity=".12">
        <rect x="792" y="78" width="12" height="9" rx="2" />
        <rect x="815" y="78" width="12" height="9" rx="2" />
        <rect x="838" y="78" width="12" height="9" rx="2" />
        <rect x="861" y="78" width="12" height="9" rx="2" />
      </g>
      <g fill="#7C3AED" opacity=".08">
        <path d="M974 69h103v23H974z" />
        <path d="m987 69 15-19h41l20 19Z" />
        <circle cx="1000" cy="92" r="10" />
        <circle cx="1051" cy="92" r="10" />
      </g>
      <path d="M1112 92V52h20V34h19v58h18V66h19v26Z" fill="#F97316" opacity=".08" />
    </svg>
  );
}
