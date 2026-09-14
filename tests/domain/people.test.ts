import { describe, it, expect } from "vitest";
import { initials } from "@/lib/utils/people";

/**
 * `initials` is four lines and is tested because it now labels every cell of
 * the implementation matrix as well as every avatar in the activity feed. The
 * two used to have their own copy; the cases below are the ones where two
 * copies would quietly diverge.
 */
describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Tanshi Mehan")).toBe("TM");
    expect(initials("priya nair")).toBe("PN");
  });

  it("stops at two, however many names there are", () => {
    // A grid cell is ~90px wide; three initials at the size that fits stop
    // being readable.
    expect(initials("Maria del Carmen Rodriguez")).toBe("MD");
  });

  it("handles one name", () => {
    expect(initials("Himanshu")).toBe("H");
  });

  it("is not confused by extra whitespace", () => {
    expect(initials("  Arjun   Mehta  ")).toBe("AM");
  });

  it("answers '?' rather than nothing when there is no name", () => {
    // An empty chip reads as a rendering fault; a "?" reads as missing data.
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials(undefined)).toBe("?");
  });
});
