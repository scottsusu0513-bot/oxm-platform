interface ArtworkProps {
  className?: string;
}

const artworkAccessibility = {
  "aria-hidden": true,
  focusable: false,
  role: "presentation",
} as const;

/** Two industry professionals exchanging ideas in a polished, lightweight 2.5D scene. */
export function CommunityHeroArtwork({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 460 200" className={className} {...artworkAccessibility}>
      <defs>
        <linearGradient id="communityHeroPurple" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="communityHeroOrange" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FDBA74" />
          <stop offset="1" stopColor="#EA580C" />
        </linearGradient>
        <linearGradient id="communityHeroSkinA" x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#F8D4B8" />
          <stop offset="1" stopColor="#E8AE86" />
        </linearGradient>
        <linearGradient id="communityHeroSkinB" x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#F3C7A5" />
          <stop offset="1" stopColor="#D9976B" />
        </linearGradient>
        <linearGradient id="communityHeroDesk" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#52647B" />
          <stop offset="1" stopColor="#26374B" />
        </linearGradient>
        <linearGradient id="communityHeroFactory" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F1ECFF" />
          <stop offset="1" stopColor="#DCD0FA" />
        </linearGradient>
        <filter id="communityHeroCardShadow" x="-25%" y="-35%" width="150%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#312E81" floodOpacity=".13" />
        </filter>
        <filter id="communityHeroObjectShadow" x="-25%" y="-35%" width="150%" height="190%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#1E293B" floodOpacity=".16" />
        </filter>
      </defs>

      <circle cx="378" cy="84" r="70" fill="#F4F0FF" />
      <circle cx="407" cy="139" r="29" fill="#FFF0E4" />
      <path d="M16 154c54-26 119-35 195-29 70 6 140 29 226 3v47H16Z" fill="#F8F6FF" />
      <ellipse cx="233" cy="181" rx="184" ry="11" fill="#D8CCF3" opacity=".46" />

      {/* Refined industrial backdrop keeps the OXM manufacturing context subtle. */}
      <g opacity=".96">
        <path d="M326 153v-48l24 13V97l27 16V89l34 20v44h-85Z" fill="url(#communityHeroFactory)" />
        <rect x="407" y="97" width="29" height="56" rx="5" fill="#FFE0C7" />
        <path d="M412 97V82h8v15m7 0V73h8v24" fill="none" stroke="#FB923C" strokeWidth="5" strokeLinecap="round" />
        <g fill="#8B5CF6" opacity=".72">
          <rect x="338" y="127" width="14" height="10" rx="2.5" />
          <rect x="360" y="127" width="14" height="10" rx="2.5" />
          <rect x="382" y="127" width="14" height="10" rx="2.5" />
          <rect x="338" y="143" width="14" height="10" rx="2.5" />
          <rect x="360" y="143" width="14" height="10" rx="2.5" />
          <rect x="382" y="143" width="14" height="10" rx="2.5" />
        </g>
        <g fill="#F97316" opacity=".75">
          <rect x="414" y="111" width="15" height="5" rx="2.5" />
          <rect x="414" y="124" width="15" height="5" rx="2.5" />
          <rect x="414" y="137" width="15" height="5" rx="2.5" />
        </g>
      </g>

      {/* Conversation cards look like product UI rather than comic speech bubbles. */}
      <g filter="url(#communityHeroCardShadow)">
        <rect x="23" y="24" width="137" height="51" rx="14" fill="#FFFFFF" />
        <circle cx="44" cy="43" r="9" fill="#EDE9FE" />
        <path d="M40 43.5 43 47l6-8" fill="none" stroke="#7C3AED" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="61" y="37" width="64" height="5" rx="2.5" fill="#6D28D9" opacity=".84" />
        <rect x="61" y="49" width="82" height="4" rx="2" fill="#D8D0F3" />
        <rect x="61" y="59" width="52" height="4" rx="2" fill="#E8E3F5" />
        <path d="m93 75 13 10 3-10" fill="#FFFFFF" />
      </g>
      <g filter="url(#communityHeroCardShadow)">
        <rect x="275" y="19" width="151" height="56" rx="14" fill="#FFFFFF" />
        <rect x="291" y="34" width="74" height="5" rx="2.5" fill="#EA580C" opacity=".88" />
        <rect x="291" y="46" width="102" height="4" rx="2" fill="#FED7AA" />
        <rect x="291" y="56" width="64" height="4" rx="2" fill="#FDE7D2" />
        <circle cx="405" cy="46" r="9" fill="#FFF0E4" />
        <path d="M401 46h8m-4-4v8" stroke="#F97316" strokeWidth="2" strokeLinecap="round" />
        <path d="m333 75 14 10 3-10" fill="#FFFFFF" />
      </g>

      {/* Left professional. */}
      <g>
        <path d="M104 142c0-25 15-42 42-42 26 0 42 17 42 42v23h-84Z" fill="#DCD5EE" opacity=".6" />
        <path d="M122 124c8-12 17-18 30-18 15 0 27 7 34 22l5 32h-81l12-36Z" fill="url(#communityHeroPurple)" />
        <path d="m138 109 14 18 15-18 7 51h-47l11-51Z" fill="#F8FAFC" />
        <path d="m138 109 14 18-12 9-10-20 8-7Zm29 0-15 18 12 9 11-20-8-7Z" fill="#7C3AED" />
        <rect x="143" y="99" width="18" height="18" rx="8" fill="url(#communityHeroSkinA)" />
        <ellipse cx="152" cy="87" rx="22" ry="25" fill="url(#communityHeroSkinA)" />
        <circle cx="131" cy="90" r="4" fill="#E8AE86" />
        <path d="M130 83c0-20 10-31 25-31 14 0 24 9 25 25-10-7-24-10-39-5-2 6-6 10-11 11Z" fill="#26374B" />
        <path d="M143 84c3-2 6-2 9 0m9 0c3-2 6-2 9 0" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="148" cy="89" r="1.7" fill="#29384A" />
        <circle cx="165" cy="89" r="1.7" fill="#29384A" />
        <path d="m158 90-1 6 4 1" fill="none" stroke="#C98263" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M149 101c5 3 10 3 15-.5" fill="none" stroke="#A85F52" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M121 129c-9 7-18 14-27 23" fill="none" stroke="#7350C4" strokeWidth="14" strokeLinecap="round" />
        <path d="M94 152c17 1 31 1 45-1" fill="none" stroke="url(#communityHeroSkinA)" strokeWidth="9" strokeLinecap="round" />
      </g>

      {/* Right professional. */}
      <g>
        <path d="M237 142c0-25 15-42 42-42 26 0 42 17 42 42v23h-84Z" fill="#E6D6CF" opacity=".58" />
        <path d="M244 128c8-15 20-22 35-22 17 0 30 9 37 26l6 28h-84l6-32Z" fill="url(#communityHeroOrange)" />
        <path d="m264 109 15 18 14-18 8 51h-46l9-51Z" fill="#FFFDFC" />
        <path d="m264 109 15 18-12 9-11-20 8-7Zm29 0-14 18 12 9 10-20-8-7Z" fill="#EA580C" opacity=".8" />
        <rect x="270" y="99" width="18" height="18" rx="8" fill="url(#communityHeroSkinB)" />
        <ellipse cx="279" cy="87" rx="22" ry="25" fill="url(#communityHeroSkinB)" />
        <circle cx="300" cy="90" r="4" fill="#D9976B" />
        <path d="M257 81c1-19 11-29 25-29 16 0 25 11 24 30-9-9-23-13-39-8-3 3-6 6-10 7Z" fill="#5A342A" />
        <path d="M263 83c4-2 7-2 10 0m9 0c3-2 7-2 10 0" fill="none" stroke="#4A342F" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="269" cy="89" r="1.7" fill="#29384A" />
        <circle cx="287" cy="89" r="1.7" fill="#29384A" />
        <path d="m278 90 1 6-4 1" fill="none" stroke="#BD7556" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M271 100c5 3 10 3 15 0" fill="none" stroke="#985847" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M313 132c10 6 19 12 27 21" fill="none" stroke="#E76A20" strokeWidth="14" strokeLinecap="round" />
        <path d="M340 153c-16 1-30 0-44-2" fill="none" stroke="url(#communityHeroSkinB)" strokeWidth="9" strokeLinecap="round" />
      </g>

      {/* Shared work surface and laptop ground the business conversation. */}
      <g filter="url(#communityHeroObjectShadow)">
        <path d="M51 151h329l18 23H34l17-23Z" fill="url(#communityHeroDesk)" />
        <path d="M34 174h364v8H34z" fill="#1F2D3D" />
        <path d="M68 182h9v12h-9zm278 0h9v12h-9z" fill="#26374B" />
      </g>
      <g filter="url(#communityHeroObjectShadow)">
        <path d="M198 117h53a6 6 0 0 1 6 6v29h-65v-29a6 6 0 0 1 6-6Z" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" />
        <circle cx="225" cy="134" r="6" fill="#EDE9FE" />
        <path d="m222 134 3 3 5-7" fill="none" stroke="#7C3AED" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M185 152h80l-6 5h-68l-6-5Z" fill="#CBD5E1" />
      </g>
      <g filter="url(#communityHeroObjectShadow)">
        <path d="M367 140h19l-2 12h-15l-2-12Z" fill="#FFFFFF" />
        <path d="M386 142c8 0 8 8 0 9" fill="none" stroke="#FFFFFF" strokeWidth="3" />
        <path d="M372 136c-2-4 3-5 1-9m7 9c-2-4 3-5 1-9" fill="none" stroke="#F6AD73" strokeWidth="1.5" strokeLinecap="round" opacity=".75" />
      </g>
    </svg>
  );
}

/** A compact compose-and-reply scene for the posting CTA. */
export function DiscussionCtaArtwork({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 210 116" className={className} {...artworkAccessibility}>
      <defs>
        <linearGradient id="communityCtaPurple" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="communityCtaOrange" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FDBA74" />
          <stop offset="1" stopColor="#EA580C" />
        </linearGradient>
        <filter id="communityCtaShadow" x="-30%" y="-35%" width="170%" height="190%">
          <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#312E81" floodOpacity=".15" />
        </filter>
      </defs>
      <circle cx="54" cy="63" r="39" fill="#FFF0E4" />
      <circle cx="159" cy="49" r="43" fill="#F3EFFF" />
      <ellipse cx="104" cy="105" rx="78" ry="7" fill="#D9D0EE" opacity=".62" />

      <g transform="rotate(-5 87 58)" filter="url(#communityCtaShadow)">
        <rect x="39" y="14" width="96" height="86" rx="13" fill="#FFFFFF" />
        <path d="M39 27c0-7 6-13 13-13h70c7 0 13 6 13 13v8H39v-8Z" fill="url(#communityCtaPurple)" />
        <circle cx="53" cy="25" r="3" fill="#FFFFFF" opacity=".9" />
        <rect x="61" y="22" width="31" height="5" rx="2.5" fill="#FFFFFF" opacity=".72" />
        <circle cx="58" cy="52" r="7" fill="#EDE9FE" />
        <path d="m55 52 3 3 5-6" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="72" y="48" width="46" height="5" rx="2.5" fill="#B7A7E7" />
        <rect x="52" y="67" width="66" height="5" rx="2.5" fill="#DDD5F1" />
        <rect x="52" y="80" width="48" height="5" rx="2.5" fill="#ECE8F6" />
      </g>

      <g filter="url(#communityCtaShadow)">
        <path d="M126 27h59a12 12 0 0 1 12 12v30a12 12 0 0 1-12 12h-22l-15 12 3-12h-25a12 12 0 0 1-12-12V39a12 12 0 0 1 12-12Z" fill="#FFFFFF" />
        <rect x="129" y="43" width="44" height="5" rx="2.5" fill="#F97316" />
        <rect x="129" y="55" width="52" height="4" rx="2" fill="#FED7AA" />
        <rect x="129" y="65" width="35" height="4" rx="2" fill="#FDE7D2" />
        <circle cx="184" cy="43" r="6" fill="#FFF0E4" />
        <path d="m181.5 43 2 2 3.5-4" fill="none" stroke="#EA580C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      <g transform="rotate(-38 131 87)" filter="url(#communityCtaShadow)">
        <rect x="126" y="68" width="11" height="38" rx="5.5" fill="url(#communityCtaOrange)" />
        <path d="m126 69 5.5-10 5.5 10Z" fill="#F5C9A8" />
        <path d="m129.5 62 2-4 2.5 4Z" fill="#475569" />
        <path d="M126 96h11v6a5.5 5.5 0 0 1-11 0v-6Z" fill="#7C3AED" />
      </g>
    </svg>
  );
}

/** A professional discovering the first opportunity on an empty discussion board. */
export function DiscussionEmptyArtwork({ className = "" }: ArtworkProps) {
  return (
    <svg viewBox="0 0 300 190" className={className} {...artworkAccessibility}>
      <defs>
        <linearGradient id="communityEmptyPurple" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="communityEmptyOrange" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FDBA74" />
          <stop offset="1" stopColor="#EA580C" />
        </linearGradient>
        <linearGradient id="communityEmptySkin" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F8D7BE" />
          <stop offset="1" stopColor="#E8AA7F" />
        </linearGradient>
        <filter id="communityEmptyCardShadow" x="-25%" y="-30%" width="155%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#312E81" floodOpacity=".13" />
        </filter>
        <filter id="communityEmptyObjectShadow" x="-30%" y="-35%" width="170%" height="190%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#1E293B" floodOpacity=".16" />
        </filter>
      </defs>

      <circle cx="224" cy="83" r="65" fill="#FFF1E6" />
      <circle cx="91" cy="58" r="45" fill="#F4F0FF" />
      <ellipse cx="151" cy="178" rx="118" ry="9" fill="#D8CCF3" opacity=".55" />

      {/* Empty search result rendered as a credible product surface. */}
      <g filter="url(#communityEmptyCardShadow)">
        <rect x="104" y="18" width="166" height="122" rx="16" fill="#FFFFFF" />
        <path d="M104 34c0-9 7-16 16-16h134c9 0 16 7 16 16v8H104v-8Z" fill="url(#communityEmptyPurple)" />
        <circle cx="120" cy="30" r="3" fill="#FFFFFF" opacity=".9" />
        <circle cx="130" cy="30" r="3" fill="#FFFFFF" opacity=".65" />
        <rect x="144" y="27" width="47" height="6" rx="3" fill="#FFFFFF" opacity=".68" />
        <rect x="122" y="55" width="128" height="23" rx="11.5" fill="#F8FAFC" stroke="#E2E8F0" />
        <circle cx="136" cy="66.5" r="5" fill="none" stroke="#8B5CF6" strokeWidth="2" />
        <path d="m140 70 4 4" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
        <rect x="151" y="63" width="65" height="5" rx="2.5" fill="#D8D0E9" />
        <rect x="122" y="89" width="128" height="35" rx="10" fill="#FCFBFF" stroke="#DED7EE" strokeDasharray="4 4" />
        <circle cx="140" cy="106" r="9" fill="#F0EBFF" />
        <path d="M136 106h8m-4-4v8" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" />
        <rect x="157" y="100" width="70" height="5" rx="2.5" fill="#D8D0E9" />
        <rect x="157" y="111" width="49" height="4" rx="2" fill="#ECE8F4" />
      </g>

      <g filter="url(#communityEmptyCardShadow)">
        <rect x="222" y="66" width="58" height="38" rx="11" fill="#FFFFFF" />
        <circle cx="237" cy="85" r="7" fill="#FFF0E4" />
        <path d="M234 85h6m-3-3v6" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="249" y="79" width="20" height="4" rx="2" fill="#FB923C" />
        <rect x="249" y="88" width="14" height="3" rx="1.5" fill="#FED7AA" />
        <path d="m243 104 9 8 2-8" fill="#FFFFFF" />
      </g>

      {/* Full, naturally proportioned professional figure. */}
      <g>
        <ellipse cx="73" cy="61" rx="14" ry="18" fill="url(#communityEmptySkin)" />
        <circle cx="59.5" cy="63" r="3" fill="#E8AA7F" />
        <path d="M59 57c0-15 7-23 18-23 12 0 19 8 19 22-7-6-16-9-27-6-3 3-6 5-10 7Z" fill="#29384A" />
        <path d="M69 38c6-2 12-1 17 3" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        <path d="M65 59c2.5-1.5 5-1.5 7.5 0m7 0c2.5-1.5 5-1.5 7.5 0" fill="none" stroke="#334155" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="69" cy="63.5" r="1.35" fill="#26374B" />
        <circle cx="82" cy="63.5" r="1.35" fill="#26374B" />
        <path d="m76 65-.8 4.5 3 1" fill="none" stroke="#C98061" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M69.5 73.5c4 2.2 8 2.2 12 0" fill="none" stroke="#A65C4D" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="67" y="76" width="13" height="15" rx="5" fill="url(#communityEmptySkin)" />
        <path d="M51 99c6-9 14-14 24-14 12 0 21 6 27 17l2 48H45l6-51Z" fill="url(#communityEmptyPurple)" />
        <path d="M65 88h19l5 56H58l7-56Z" fill="#F8FAFC" />
        <path d="m64 88 11 14-10 7-9-13 8-8Zm20 0-9 14 9 7 9-13-9-8Z" fill="#7650C9" />
        <path d="M75 103v37" stroke="#E2E8F0" strokeWidth="1.5" />
        <circle cx="78" cy="116" r="1.5" fill="#A78BFA" />
        <circle cx="78" cy="130" r="1.5" fill="#A78BFA" />
        <path d="M51 102c-7 13-9 24-8 37" fill="none" stroke="#7650C9" strokeWidth="10" strokeLinecap="round" />
        <path d="M98 104c8 11 15 22 21 32" fill="none" stroke="#7650C9" strokeWidth="10" strokeLinecap="round" />
        <circle cx="120" cy="138" r="5.5" fill="url(#communityEmptySkin)" />
        <path d="M55 148 50 174h15l10-26m17 0 9 26H86l-11-26" fill="#3A485B" />
        <path d="M48 174h18v6H44c0-3 1-5 4-6Zm38 0h17c3 1 5 3 5 6H86v-6Z" fill="#26374B" />
      </g>

      {/* Magnifier and opportunity marker carry the discovery message. */}
      <g filter="url(#communityEmptyObjectShadow)">
        <circle cx="153" cy="104" r="29" fill="#FFFFFF" fillOpacity=".78" stroke="url(#communityEmptyPurple)" strokeWidth="7" />
        <circle cx="153" cy="104" r="18" fill="#F7F3FF" fillOpacity=".7" />
        <path d="m133 125-17 24" stroke="#6D28D9" strokeWidth="9" strokeLinecap="round" />
        <path d="m117 147-6 9" stroke="#FB923C" strokeWidth="9" strokeLinecap="round" />
      </g>
      <g filter="url(#communityEmptyObjectShadow)">
        <circle cx="268" cy="39" r="15" fill="url(#communityEmptyOrange)" />
        <path d="M268 32v14m-7-7h14" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <path d="M33 45h11m-5.5-5.5v11" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <circle cx="25" cy="73" r="3" fill="#8B5CF6" opacity=".55" />
    </svg>
  );
}

/** Low-contrast 2.5D manufacturing silhouettes that finish the page without adding weight. */
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
