import { Suspense } from "react";
import LoginForm from "./LoginForm";

// useSearchParams() (read in LoginForm for the ?next= redirect) requires a
// Suspense boundary under Next 15's static-generation rules.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
