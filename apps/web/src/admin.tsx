import { AdminDashboard } from "./AdminDashboard";
import { followAppTheme } from "./admin/admin-appearance";
import "./admin.css";
import { mountPrerenderedPage } from "./mount-page";

// The admin wears the theme the app keeps, for as long as the page is open.
followAppTheme();

mountPrerenderedPage(<AdminDashboard />);
