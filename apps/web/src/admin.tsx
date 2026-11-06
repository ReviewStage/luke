import { AdminDashboard } from "./AdminDashboard";
import { followAppTheme } from "./admin/admin-appearance";
import "./admin.css";
import { mountPrerenderedPage } from "./mount-page";

followAppTheme();

mountPrerenderedPage(<AdminDashboard />);
