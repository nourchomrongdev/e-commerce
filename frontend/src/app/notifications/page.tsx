import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import { NotificationCenter } from "@/components/notifications/NotificationHub";

export default function NotificationsPage() {
  return (
    <>
      <Navbar active={null} />
      <NotificationCenter />
      <PublicFooter />
    </>
  );
}
