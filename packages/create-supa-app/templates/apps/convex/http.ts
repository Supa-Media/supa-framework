import { httpRouter } from "convex/server";
import { auth } from "./auth";
{{HTTP_IMPORTS}}
const http = httpRouter();

// Auth routes (handles OTP verification callbacks)
auth.addHttpRoutes(http);
{{HTTP_ROUTES}}
export default http;
