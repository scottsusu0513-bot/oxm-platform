type IllustrationProps = {
  className?: string;
};

const ink = "#334155";
const mutedInk = "#94a3b8";
const orange = "#f97316";
const orangeSoft = "#ffedd5";
const purple = "#9333ea";
const purpleSoft = "#f3e8ff";

function IllustrationFrame({
  className,
  viewBox,
  children,
}: IllustrationProps & { viewBox: string; children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={viewBox}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function HeroFaqIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 270 180" className={className}>
      <ellipse cx="132" cy="151" rx="105" ry="10" fill="#e2e8f0" opacity="0.65" />
      <path
        d="M40 137V82l18 6V57h19v37l9 3V82l31 11v44H40Z"
        fill="#fff"
        stroke={ink}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M61 60h13v30l-13-4V60Z" fill={orangeSoft} />
      <path d="M51 106h13m14 0h13M51 119h13m14 0h13" stroke={orange} strokeWidth="4" strokeLinecap="round" />
      <rect x="99" y="111" width="13" height="26" rx="2" fill={purpleSoft} stroke={purple} strokeWidth="2.5" />
      <path d="M34 137h91" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <path
        d="M151 41h70a13 13 0 0 1 13 13v31a13 13 0 0 1-13 13h-37l-17 14 4-14h-20a13 13 0 0 1-13-13V54a13 13 0 0 1 13-13Z"
        fill="#fff"
        stroke={purple}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="166" cy="69" r="13" fill={orangeSoft} stroke={orange} strokeWidth="2.5" />
      <path d="M161 66c0-3 2-5 5-5s5 2 5 5c0 4-5 4-5 8" stroke={ink} strokeWidth="2.7" strokeLinecap="round" />
      <circle cx="166" cy="79" r="1.8" fill={ink} />
      <path d="M188 62h28M188 72h23M188 82h17" stroke={mutedInk} strokeWidth="3" strokeLinecap="round" />
      <path d="m222 23 2 8 8 2-8 2-2 8-2-8-8-2 8-2 2-8Z" fill={orange} />
      <circle cx="244" cy="53" r="5" fill={purpleSoft} stroke={purple} strokeWidth="2" />
    </IllustrationFrame>
  );
}

export function AiCompanionIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 150 120" className={className}>
      <ellipse cx="75" cy="102" rx="53" ry="8" fill="#e2e8f0" opacity="0.65" />
      <g className="motion-safe:animate-pulse [animation-duration:5s]">
        <path d="M38 36h67a15 15 0 0 1 15 15v29a15 15 0 0 1-15 15H76l-18 15 4-15H38a15 15 0 0 1-15-15V51a15 15 0 0 1 15-15Z" fill="#fff" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <circle cx="53" cy="67" r="4" fill={orange} />
        <circle cx="72" cy="67" r="4" fill={purple} />
        <path d="M86 67h17" stroke={mutedInk} strokeWidth="4" strokeLinecap="round" />
      </g>
      <path d="m119 20 2.5 9.5L131 32l-9.5 2.5L119 44l-2.5-9.5L107 32l9.5-2.5L119 20Z" fill={purpleSoft} stroke={purple} strokeWidth="2" strokeLinejoin="round" />
      <path d="m34 18 1.5 6 6 1.5-6 1.5-1.5 6-1.5-6-6-1.5 6-1.5 1.5-6Z" fill={orange} />
    </IllustrationFrame>
  );
}

function MarketIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 210 150" className={className}>
      <ellipse cx="105" cy="128" rx="83" ry="9" fill="#e2e8f0" opacity="0.65" />
      <path
        d="M29 118V66l18 6V43h19v35l8 3V66l32 11v41H29Z"
        fill="#fff"
        stroke={ink}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M50 46h13v28l-13-4V46Z" fill={orangeSoft} />
      <path d="M41 90h13m14 0h13M41 104h13m14 0h13" stroke={orange} strokeWidth="4" strokeLinecap="round" />
      <rect x="87" y="96" width="13" height="22" rx="2" fill={purpleSoft} stroke={purple} strokeWidth="2.5" />
      <path d="M24 118h88" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <g transform="rotate(-6 150 99)">
        <path d="m126 84 24-8 25 9-25 9-24-10Z" fill="#faf5ff" stroke={purple} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="m126 84 24 10v29l-24-10V84Z" fill={purpleSoft} stroke={purple} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="m150 94 25-9v29l-25 9V94Z" fill="#fff" stroke={purple} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M138 81.5 162 90" stroke={purple} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      </g>
      <path d="M102 69c13-18 35-22 51-7m-11-1 11 1-3-11" stroke={orange} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="181" cy="105" r="5.5" fill={orangeSoft} stroke={orange} strokeWidth="2.5" />
    </IllustrationFrame>
  );
}

function TransformationIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 210 150" className={className}>
      <ellipse cx="106" cy="130" rx="82" ry="9" fill="#e2e8f0" opacity="0.65" />
      <g transform="translate(75 84)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect key={angle} x="-4" y="-41" width="8" height="14" rx="2.5" fill={ink} transform={`rotate(${angle})`} />
        ))}
        <circle r="33" fill={orangeSoft} stroke={ink} strokeWidth="3" />
        <circle r="20" fill="#fff" stroke={ink} strokeWidth="2.5" />
        <path d="M0-19V-9M0 9v10M-19 0h10M9 0h10M-13-13l7 7M6 6l7 7M13-13 6-6M-6 6l-7 7" stroke={orange} strokeWidth="3" strokeLinecap="round" />
        <circle r="8" fill="#fff" stroke={orange} strokeWidth="3" />
      </g>
      <g transform="translate(136 103)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect key={angle} x="-3.5" y="-30" width="7" height="11" rx="2" fill={purple} transform={`rotate(${angle})`} />
        ))}
        <circle r="23" fill={purpleSoft} stroke={purple} strokeWidth="3" />
        <circle r="13" fill="#fff" stroke={purple} strokeWidth="2.5" />
        <path d="M0-12v6M0 6v6M-12 0h6M6 0h6M-8-8l4 4M4 4l4 4M8-8 4-4M-4 4l-4 4" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
        <circle r="5.5" fill="#fff" stroke={ink} strokeWidth="2.5" />
      </g>
      <path d="M24 93C31 33 111 17 168 59m-12-3 12 3-2-12" stroke={orange} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </IllustrationFrame>
  );
}

function ResourcesIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 210 150" className={className}>
      <ellipse cx="105" cy="131" rx="84" ry="9" fill="#e2e8f0" opacity="0.65" />
      <g transform="rotate(-3 82 89)">
        <path d="M42 48h62l17 17v62H42V48Z" fill="#fff" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <path d="M104 48v17h17" fill={orangeSoft} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <path d="M58 74h39M58 88h29M58 102h35" stroke={mutedInk} strokeWidth="4" strokeLinecap="round" />
        <path d="m92 108 7 7 16-19" stroke={orange} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M134 58c0-15 12-27 27-27s27 12 27 27c0 11-6 18-14 24-4 3-5 6-5 11h-16c0-5-2-8-6-11-8-6-13-13-13-24Z" fill={purpleSoft} stroke={purple} strokeWidth="3" />
      <path d="M153 93h16v8a8 8 0 0 1-8 8 8 8 0 0 1-8-8v-8Zm2 18h12" fill="#fff" stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m152 58 7 7 13-17" stroke={orange} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m32 37 2 8 8 2-8 2-2 8-2-8-8-2 8-2 2-8Z" fill={orange} className="motion-safe:animate-pulse [animation-duration:3s]" />
    </IllustrationFrame>
  );
}

function AboutIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 210 150" className={className}>
      <ellipse cx="105" cy="130" rx="83" ry="9" fill="#e2e8f0" opacity="0.65" />
      <path d="M37 41h68a13 13 0 0 1 13 13v31a13 13 0 0 1-13 13H79l-17 14 3-14H37a13 13 0 0 1-13-13V54a13 13 0 0 1 13-13Z" fill="#fff" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
      <text x="42" y="77" fill={orange} fontSize="22" fontWeight="800" fontFamily="sans-serif">OXM</text>
      <path d="M135 61h35a14 14 0 0 1 14 14v19a14 14 0 0 1-14 14h-11l-13 11 2-11h-13a14 14 0 0 1-14-14V75a14 14 0 0 1 14-14Z" fill={purpleSoft} stroke={purple} strokeWidth="3" strokeLinejoin="round" />
      <path d="M143 79c4-7 13-5 14 2 2-7 12-9 15-2 4 9-15 19-15 19s-19-10-14-19Z" fill={orangeSoft} stroke={orange} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M116 74c4-5 8-7 13-8" stroke={orange} strokeWidth="3" strokeLinecap="round" />
      <circle cx="176" cy="53" r="7" fill={orangeSoft} stroke={orange} strokeWidth="2" className="motion-safe:animate-pulse [animation-duration:4s]" />
      <path d="m143 38 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Z" fill={orange} />
    </IllustrationFrame>
  );
}

export function CategoryIllustration({
  categoryId,
  className,
}: IllustrationProps & { categoryId: string }) {
  if (categoryId === "market") return <MarketIllustration className={className} />;
  if (categoryId === "transformation") return <TransformationIllustration className={className} />;
  if (categoryId === "resources") return <ResourcesIllustration className={className} />;
  return <AboutIllustration className={className} />;
}

export function CtaCollaborationIllustration({ className }: IllustrationProps) {
  return (
    <img
      src="/images/faq/handshake-cta-final.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  );
}
