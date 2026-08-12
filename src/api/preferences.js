import { getComparisonPreference, updateComparisonPreference } from "../services/preferences.js";

export const preferenceRoutes = [
  {
    method: "GET",
    path: "/api/preferences/comparison",
    handler: () => getComparisonPreference(),
  },
  {
    method: "PATCH",
    path: "/api/preferences/comparison",
    handler: ({ body }) => updateComparisonPreference(body),
  },
];
