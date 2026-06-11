import { lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { COMMUNITY_FEATURE_STATUS } from "@shared/const";
import CommunityComingSoon from "@/components/community/CommunityComingSoon";
import { AppLoading } from "@/components/AppLoading";

const CommunityHome = lazy(() => import("@/components/community/CommunityHome"));
const CommunitySpace = lazy(() => import("@/components/community/CommunitySpace"));
const CommunityPost = lazy(() => import("@/components/community/CommunityPost"));

// Resolves which content is accessible based on feature status and user role
function canAccessCommunity(role: "user" | "admin" | undefined): boolean {
  if (COMMUNITY_FEATURE_STATUS === "live") return true;
  if (COMMUNITY_FEATURE_STATUS === "beta") return role === "admin";
  return false; // coming_soon | maintenance
}

export default function Community() {
  const [location] = useLocation();
  const { user, loading } = useAuth();

  // Parse sub-path: /community/<spaceCode>/<postId>
  const raw = location.replace(/^\/community\/?/, "");
  const segments = raw ? raw.split("/").filter(Boolean) : [];
  const spaceCode = segments[0] ?? null;
  const postIdRaw = segments[1] ?? null;
  const postId = postIdRaw ? parseInt(postIdRaw, 10) : null;

  // Wait for auth resolution before gating — prevents beta flash for admins
  if (loading) return <AppLoading />;

  if (!canAccessCommunity(user?.role)) {
    return <CommunityComingSoon />;
  }

  return (
    <Suspense fallback={<AppLoading />}>
      {postId && spaceCode ? (
        <CommunityPost spaceCode={spaceCode} postId={postId} />
      ) : spaceCode ? (
        <CommunitySpace spaceCode={spaceCode} />
      ) : (
        <CommunityHome />
      )}
    </Suspense>
  );
}
