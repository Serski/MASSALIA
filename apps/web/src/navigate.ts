// Client-side navigation for the app's pathname router (App.tsx listens to
// popstate): push the path, wake the router, scroll to the top.
export function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
