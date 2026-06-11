import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { COMMUNITY_FEATURE_STATUS, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import { INDUSTRY_SLUGS } from "@shared/constants";
import CommunityComingSoon from "@/components/community/CommunityComingSoon";
import CommunityBoardLayout from "@/components/community/CommunityBoardLayout";
import { AppLoading } from "@/components/AppLoading";

const CommunityPost = lazy(() => import("@/components/community/CommunityPost"));
const CommunityNotifications = lazy(() => import("@/components/community/CommunityNotifications"));

// First slug from INDUSTRY_SLUGS — matches INDUSTRIES[0] = "紡織"
const DEFAULT_SPACE_CODE = Object.values(INDUSTRY_SLUGS)[0] ?? "textile";

const VALID_SPACE_CODES = new Set<string>([
  ...Object.values(INDUSTRY_SLUGS),
  COMMUNITY_CROSS_INDUSTRY_SLUG,
]);

const VALID_SECTIONS = new Set(["discussions", "bids"]);

function canAccessCommunity(role: "user" | "admin" | undefined): boolean {
  if (COMMUNITY_FEATURE_STATUS === "live") return true;
  if (COMMUNITY_FEATURE_STATUS === "beta") return role === "admin";
  return false; // coming_soon | maintenance
}

// Redirect via useEffect to avoid calling navigate during render
function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return <AppLoading />;
}

export default function Community() {
  const [location] = useLocation();
  const { user, loading } = useAuth();

  if (loading) return <AppLoading />;
  if (!canAccessCommunity(user?.role)) return <CommunityComingSoon />;

  // Parse sub-path segments after /community/
  const raw = location.replace(/^\/community\/?/, "");
  const segments = raw ? raw.split("/").filter(Boolean) : [];
  const seg0 = segments[0] ?? null; // spaceCode | "notifications" | null
  const seg1 = segments[1] ?? null; // "discussions" | "bids" | legacy numericPostId | null
  const seg2 = segments[2] ?? null; // numericPostId (new route: /spaceCode/discussions/:id)

  // /community → redirect to default discussions
  if (!seg0) {
    return <Redirect to={`/community/${DEFAULT_SPACE_CODE}/discussions`} />;
  }

  // /community/notifications
  if (seg0 === "notifications") {
    return (
      <Suspense fallback={<AppLoading />}>
        <CommunityNotifications />
      </Suspense>
    );
  }

  const spaceCode = seg0;

  // /community/:spaceCode (no section) → redirect to discussions
  if (!seg1) {
    return <Redirect to={`/community/${spaceCode}/discussions`} />;
  }

  // Backward compat: /community/:spaceCode/:numericPostId (old URL format)
  // seg1 is a number and not a known section keyword
  const legacyPostId = parseInt(seg1, 10);
  if (!isNaN(legacyPostId) && !VALID_SECTIONS.has(seg1)) {
    return <Redirect to={`/community/${spaceCode}/discussions/${legacyPostId}`} />;
  }

  // /community/:spaceCode/discussions/:postId (new post detail route)
  if (seg1 === "discussions" && seg2) {
    const postId = parseInt(seg2, 10);
    if (!isNaN(postId)) {
      return (
        <Suspense fallback={<AppLoading />}>
          <CommunityPost spaceCode={spaceCode} postId={postId} />
        </Suspense>
      );
    }
  }

  // /community/:spaceCode/discussions or /community/:spaceCode/bids
  if (seg1 === "discussions" || seg1 === "bids") {
    // Guard: unknown spaceCode → redirect to default
    if (!VALID_SPACE_CODES.has(spaceCode)) {
      return <Redirect to={`/community/${DEFAULT_SPACE_CODE}/discussions`} />;
    }
    return <CommunityBoardLayout spaceCode={spaceCode} section={seg1} />;
  }

  // Unknown sub-path → fallback to discussions for the given space
  return <Redirect to={`/community/${spaceCode}/discussions`} />;
}
