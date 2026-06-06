import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App landing flow", () => {
  test("moves to the host password step", async () => {
    window.localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Host Game" }));

    expect(await screen.findByText("Host password")).toBeInTheDocument();
  });
});
