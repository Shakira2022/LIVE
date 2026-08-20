import type { MockUser, Responder } from "@/lib/types";

export function getResponderForUser(
  responders: Responder[],
  user: MockUser,
): Responder | undefined {
  const directMatch = responders.find(
    (responder) => responder.userId === user.id,
  );

  if (directMatch) {
    return directMatch;
  }

  // Prototype demo-account mapping:
  // The authenticated Supabase user has a real UUID, while
  // the mock responder profile uses "usr-responder-001".
  if (
    user.role === "responder" &&
    user.email === "responder@live.co.za"
  ) {
    return responders.find(
      (responder) => responder.id === "rsp-001",
    );
  }

  return undefined;
}