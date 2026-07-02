import "./ui/styles.css";
import { render, type Screen } from "./ui/screens";

const app = document.getElementById("app");
if (!app) throw new Error("No se encontró #app");

const SCREENS: Screen[] = ["landing", "local", "online", "m0"];

function currentScreen(): Screen {
  const h = location.hash.slice(1) as Screen;
  return SCREENS.includes(h) ? h : "landing";
}

function go(screen: Screen): void {
  // Cambiar el hash dispara "hashchange" -> render. Si ya estamos en ese hash,
  // renderizamos directo (setear el mismo hash no dispara el evento).
  if (location.hash.slice(1) === screen) render(app!, go, screen);
  else location.hash = screen;
}

window.addEventListener("hashchange", () => render(app!, go, currentScreen()));
render(app, go, currentScreen());
