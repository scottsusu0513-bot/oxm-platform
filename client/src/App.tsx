import { Toaster } from "@/components/ui/sonner";
import AdminConversationDetail from "@/pages/AdminConversationDetail";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Search from "./pages/Search";
import FactoryDetail from "./pages/FactoryDetail";
import FactoryRegister from "./pages/FactoryRegister";
import FactoryDashboard from "./pages/FactoryDashboard";
import ChatPage from "./pages/ChatPage";
import MyMessages from "./pages/MyMessages";
import MyFavorites from "./pages/MyFavorites";
import AdminDashboard from "./pages/AdminDashboard";
import ConversationsList from "./pages/ConversationsList";
import UsersList from "./pages/UsersList";
import FactoriesList from "./pages/FactoriesList";
import ProductsList from "./pages/ProductsList";
import ReviewsList from "./pages/ReviewsList";
import AdsList from "./pages/AdsList";
import FactoryReviewDetail from "./pages/FactoryReviewDetail";
import PendingFactoriesList from "./pages/PendingFactoriesList";
import MemberCenter from "./pages/MemberCenter";
import AdminSupportCenter from "./pages/AdminSupportCenter";
import Announcements from "./pages/Announcements";
import AdminAnnouncements from "./pages/AdminAnnouncements";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/search" component={Search} />
      <Route path="/factory/:id" component={FactoryDetail} />
      <Route path="/register-factory" component={FactoryRegister} />
      <Route path="/dashboard" component={FactoryDashboard} />
      <Route path="/chat/new" component={ChatPage} />
      <Route path="/chat/:conversationId" component={ChatPage} />
      <Route path="/messages" component={MyMessages} />
      <Route path="/favorites" component={MyFavorites} />
      <Route path="/member" component={MemberCenter} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/conversations/:id" component={AdminConversationDetail} />
      <Route path="/admin/conversations" component={ConversationsList} />
      <Route path="/admin/users" component={UsersList} />
      <Route path="/admin/factories" component={FactoriesList} />
      <Route path="/admin/products" component={ProductsList} />
      <Route path="/admin/reviews" component={ReviewsList} />
      <Route path="/admin/ads" component={AdsList} />
      <Route path="/admin/factory-review" component={FactoryReviewDetail} />
      <Route path="/admin/pending-factories" component={PendingFactoriesList} />
      <Route path="/admin/support" component={AdminSupportCenter} />
      <Route path="/admin/announcements" component={AdminAnnouncements} />
      <Route path="/announcements" component={Announcements} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
