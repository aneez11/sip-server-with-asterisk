type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let installEvent: BeforeInstallPromptEvent | null = null;
let installButton: HTMLButtonElement | null = null;

function showBanner(text: string, actionLabel: string, onAction: () => void) {
  document.getElementById("pwa-banner")?.remove();

  const banner = document.createElement("div");
  banner.id = "pwa-banner";
  banner.className = "pwa-banner";

  const message = document.createElement("span");
  message.textContent = text;

  const action = document.createElement("button");
  action.type = "button";
  action.className = "pwa-action";
  action.textContent = actionLabel;
  action.addEventListener("click", () => {
    banner.remove();
    onAction();
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "pwa-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => banner.remove());

  banner.append(message, action, close);
  document.body.appendChild(banner);
}

function showInstallButton() {
  if (installButton || !installEvent) return;
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone
  ) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pwa-install";
  button.textContent = "Install app";
  button.addEventListener("click", () => {
    const event = installEvent;
    if (!event) return;
    void event.prompt().then(async () => {
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") {
        button.remove();
        installButton = null;
      }
      installEvent = null;
    });
  });

  installButton = button;
  document.body.appendChild(button);
}

function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        const showUpdate = (worker: ServiceWorker) => {
          showBanner("A new version is available.", "Refresh", () => {
            worker.postMessage("SKIP_WAITING");
          });
        };

        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              showUpdate(worker);
            }
          });
        });

        const check = () => void registration.update().catch(() => undefined);
        setInterval(check, 30 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      })
      .catch(() => undefined);

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

if (import.meta.env.PROD) {
  initServiceWorker();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event as BeforeInstallPromptEvent;
    showInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installButton?.remove();
    installButton = null;
    installEvent = null;
  });
}
