import { DDatabase } from "..";
import { SupabaseClient, createClient } from "@supabase/supabase-js";

let test_URL: string;
let test_Key: string;

let test_database: DDatabase;

// Needed if we want to test
// for errors or cleanup stuff
let test_client: SupabaseClient;

beforeAll(async () => {
  // Tests depend on environment variables
  // TEST_URL and TEST_KEY, which should
  // hold the URL and public anonymous key for
  // a test API, not meant for production.
  if (process.env.TEST_URL == undefined || process.env.TEST_KEY == undefined) {
    throw new Error(
      "TEST_URL and TEST_KEY must be defined as environment variables for tests to work!"
    );
  }
  test_URL = process.env.TEST_URL;
  test_Key = process.env.TEST_KEY;
  test_client = createClient(test_URL, test_Key);
  test_database = await DDatabase.build({
    supabaseUrl: test_URL,
    supabaseKey: test_Key,
  });
});

describe("Dplatform Database", () => {
  describe("build() factory method", () => {
    it("Throws an error given no URL", async () => {
      return expect(
        DDatabase.build({
          supabaseUrl: "",
          supabaseKey: "lala",
        })
      ).rejects.toThrow("supabaseUrl is required");
    });
    it("Throws an error given non-URL", async () => {
      return expect(
        DDatabase.build({
          supabaseUrl: "lala",
          supabaseKey: "lala",
        })
      ).rejects.toThrow("Invalid URL");
    });
    it("Throws an error given irrelevant URL", async () => {
      return expect(
        DDatabase.build({
          supabaseUrl: "https://s-kybound.github.io/",
          supabaseKey: "lala",
        })
      ).rejects.toThrow();
    });
    it("Throws an error given valid URL but incorrect key", async () => {
      return expect(
        DDatabase.build({
          supabaseUrl: test_URL,
          supabaseKey: "lala",
        })
      ).rejects.toThrow("Invalid API key");
    });
    it("Proceeds with no error if given valid URL and key", async () => {
      return expect(
        // This is a dummy database that we won't use.
        DDatabase.build({
          supabaseUrl: test_URL,
          supabaseKey: test_Key,
        })
      ).resolves.toBeInstanceOf(DDatabase);
    });
  });
  describe("instance", () => {
    let test_id: number;
    beforeAll(async () => {
      // We initialize a test user.
      await test_client.from("USERS").insert({
        name: "test",
        telegram_id: "test",
        nus_email: "test",
        room: "test",
      });
      const { data, error } = await test_client
        .from("USERS")
        .select("*")
        .eq("telegram_id", "test");
      test_id = data![0].id;
    });
    afterAll(async () => {
      // Delete all data entries
      // pertaining to our test account
      await test_client.from("SLOTS").delete().eq("booked_by", test_id);
      await test_client.from("USERS").delete().eq("telegram_id", "test");
      await test_client.from("BALLOTS").delete().eq("user_id", test_id);
    });
    describe("isUser method", () => {
      beforeAll(async () => {
        // Create an invalid situation in which 2 users share a telegram account
        await test_client.from("USERS").insert({
          name: "test2",
          telegram_id: "test2",
          nus_email: "test",
          room: "test",
        });
        await test_client.from("USERS").insert({
          name: "test3",
          telegram_id: "test2",
          nus_email: "test",
          room: "test",
        });
      });
      afterAll(async () => {
        await test_client.from("USERS").delete().eq("telegram_id", "test2");
      });
      it("detects that a user is in the database", async () => {
        return expect(test_database.isUser("test")).resolves.toEqual(true);
      });
      it("detects that a user is not in the database", async () => {
        return expect(test_database.isUser("foo")).resolves.toEqual(false);
      });
    });
    describe("addUser method", () => {
      afterAll(async () => {
        await test_client.from("USERS").delete().eq("telegram_id", "test2");
      });
      it("initializes a new user as expected", async () => {
        return expect(
          test_database
            .addUser({
              name: "test2",
              telegramId: "test2",
              nusEmail: "test",
              room: "test",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("ok");
      });
      it("returns an error if the user intended to add has a duplicate telegram account", async () => {
        return expect(
          test_database
            .addUser({
              name: "test3",
              telegramId: "test",
              nusEmail: "test",
              room: "test",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("There exists a user with the same account!");
      });
    });
    describe("delUser method", () => {
      it("deletes a user as expected", async () => {
        await test_database.addUser({
          name: "test2",
          telegramId: "test2",
          nusEmail: "test",
          room: "test",
        });
        return expect(
          test_database.delUser("test2").then((result) =>
            result.match({
              ok: (_) => "ok",
              err: (err) => err.message,
            })
          )
        ).resolves.toEqual("ok");
      });
      it("returns an error on attempt to delete nonexistent user", async () => {
        return expect(
          test_database.delUser("i-don't-exist").then((result) =>
            result.match({
              ok: (_) => "ok",
              err: (err) => err.message,
            })
          )
        ).resolves.toEqual("There is no user with that telegram ID!");
      });
    });
    describe("isBooked method", () => {
      beforeAll(async () => {
        // Book 2000 Jan 1 12pm - 1pm
        await test_client.from("SLOTS").insert({
          booked_by: test_id,
          time_begin: "2000-01-01T12:00:00+0000",
          time_end: "2000-01-01T13:00:00+0000",
        });
      });
      afterAll(async () => {
        await test_client.from("SLOTS").delete().eq("booked_by", test_id);
      });
      it("throws error if startTime > endTime", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T14:00:00+0000",
            "2000-01-01T13:00:00+0000"
          )
        ).rejects.toThrow("strictly be before");
      });
      it("throws error if startTime = endTime", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T13:00:00+0000",
            "2000-01-01T13:00:00+0000"
          )
        ).rejects.toThrow("strictly be before");
      });
      it("detects that specified time is booked (full overlap)", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T12:00:00+0000",
            "2000-01-01T13:00:00+0000"
          )
        ).resolves.toEqual(true);
      });
      it("detects that specified time is booked (overlap with later slot)", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T11:00:00+0000",
            "2000-01-01T12:30:00+0000"
          )
        ).resolves.toEqual(true);
      });
      it("detects that specified time is booked (overlap with earlier slot)", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T12:30:00+0000",
            "2000-01-01T14:00:00+0000"
          )
        ).resolves.toEqual(true);
      });
      it("detects that specified time is free (completely free)", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T00:00:00+0000",
            "2000-01-01T01:00:00+0000"
          )
        ).resolves.toEqual(false);
      });
      it("detects that specified time is free (our slot aligns with later slot)", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T11:00:00+0000",
            "2000-01-01T12:00:00+0000"
          )
        ).resolves.toEqual(false);
      });
      it("detects that specified time is free (our slot aligns with earlier slot)", async () => {
        return expect(
          test_database.isBooked(
            "2000-01-01T13:00:00+0000",
            "2000-01-01T14:00:00+0000"
          )
        ).resolves.toEqual(false);
      });
    });
    describe("bookSlot method", () => {
      beforeAll(async () => {
        // Book 2000 Jan 1 12pm - 1pm
        await test_client.from("SLOTS").insert({
          booked_by: test_id,
          time_begin: "2000-01-01T12:00:00+0000",
          time_end: "2000-01-01T13:00:00+0000",
        });
      });
      afterAll(async () => {
        await test_client.from("SLOTS").delete().eq("booked_by", test_id);
      });
      it("books a free slot (slot is completely free)", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T00:00:00+0000",
              endTime: "2000-01-01T01:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("ok");
      });
      it("books a free slot (slot aligns with later slot)", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T11:00:00+0000",
              endTime: "2000-01-01T12:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("ok");
      });
      it("books a free slot (slot aligns with earlier slot)", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T13:00:00+0000",
              endTime: "2000-01-01T14:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("ok");
      });
      it("returns error if startTime > endTime", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T01:00:00+0000",
              endTime: "2000-01-01T00:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("Start time must strictly be before end time!");
      });
      it("returns error if startTime > endTime (malformed time)", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T13:00:00+0000",
              endTime: "2000-01-01T4:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("Start time must strictly be before end time!");
      });
      it("returns error if startTime = endTime", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T00:00:00+0000",
              endTime: "2000-01-01T00:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("Start time must strictly be before end time!");
      });
      it("returns an error if booking a taken slot", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T12:00:00+0000",
              endTime: "2000-01-01T13:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual(
          "Unable to book the entire slot, part/all of it is already booked"
        );
      });
      it("returns an error booking a slot for a nonexistent user", async () => {
        return expect(
          test_database
            .bookSlot({
              userTelegramId: "i-don't-exist",
              startTime: "2000-01-01T12:00:00+0000",
              endTime: "2000-01-01T13:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("There is no user with that telegram ID!");
      });
    });
    describe("delSlot method", () => {
      afterAll(async () => {
        await test_client.from("SLOTS").delete().eq("booked_by", test_id);
      });
      it("deletes a booked slot", async () => {
        await test_database.bookSlot({
          userTelegramId: "test",
          startTime: "2000-01-01T12:00:00+0000",
          endTime: "2000-01-01T13:00:00+0000",
        });
        return expect(
          test_database
            .delSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T12:00:00+0000",
              endTime: "2000-01-01T13:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("ok");
      });
      it("deletes only the specified slot", async () => {
        await test_database.bookSlot({
          userTelegramId: "test",
          startTime: "2000-01-01T12:00:00+0000",
          endTime: "2000-01-01T13:00:00+0000",
        });
        await test_database.bookSlot({
          userTelegramId: "test",
          startTime: "2000-01-01T13:00:00+0000",
          endTime: "2000-01-01T14:00:00+0000",
        });
        await test_database
          .delSlot({
            userTelegramId: "test",
            startTime: "2000-01-01T12:00:00+0000",
            endTime: "2000-01-01T13:00:00+0000",
          })
          .then((result) =>
            result.match({
              ok: (_) => "ok",
              err: (err) => err.message,
            })
          );
        return expect(
          test_database.isBooked(
            "2000-01-01T13:10:00+0000",
            "2000-01-01T13:50:00+0000"
          )
        ).resolves.toEqual(true);
      });
      it("does nothing if no slots match", async () => {
        return expect(
          test_database
            .delSlot({
              userTelegramId: "test",
              startTime: "2000-01-01T00:00:00+0000",
              endTime: "2000-01-01T01:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("ok");
      });
      it("returns an error attempting to delete a slot for a nonexistent user", async () => {
        return expect(
          test_database
            .delSlot({
              userTelegramId: "i-don't-exist",
              startTime: "2000-01-01T00:00:00+0000",
              endTime: "2000-01-01T01:00:00+0000",
            })
            .then((result) =>
              result.match({
                ok: (_) => "ok",
                err: (err) => err.message,
              })
            )
        ).resolves.toEqual("There is no user with that telegram ID!");
      });
    });
    describe("getSlotsByUser method", () => {
      afterAll(async () => {
        await test_client.from("SLOTS").delete().eq("booked_by", test_id);
      });
      it("can access all bookings for a user", async () => {
        await test_database.bookSlot({
          userTelegramId: "test",
          startTime: "2000-01-01T12:00:00+0000",
          endTime: "2000-01-01T13:00:00+0000",
        });
        await test_database.bookSlot({
          userTelegramId: "test",
          startTime: "2000-01-01T13:00:00+0000",
          endTime: "2000-01-01T14:00:00+0000",
        });
        return expect(
          test_database.getSlotsByUser("test").then((result) => result.length)
        ).resolves.toEqual(2);
      });
      it("returns an error attempting to access a nonexistent user", async () => {
        return expect(
          test_database
            .getSlotsByUser("i-don't-exist")
            .then((result) => result.length)
        ).rejects.toThrowError();
      });
    });
    describe("getUserEmail method", () => {
      it("can get the email of a user", async () => {
        return expect(test_database.getUserEmail("test")).resolves.toEqual(
          "test"
        );
      });
      it("returns null if the user does not exist", async () => {
        return expect(
          test_database.getUserEmail("i-don't-exist")
        ).resolves.toBeNull();
      });
    });
    describe("addBallot method", () => {
      // Book a slot. Test user shouldn't be able to book this slot.
      beforeAll(async () => {
        // Create another user to test conflicting ballots
        await test_database.addUser({
          name: "test2",
          telegramId: "test2",
          nusEmail: "test",
          room: "test",
        });
        // For our user, create a ballot that he has already balloted
        await test_client.from("BALLOTS").insert({
          user_id: test_id,
          telegram_id: "test",
          time_begin: new Date("2000-01-01T12:00:00+0000"),
          time_end: new Date("2000-01-01T12:30:00+0000"),
        });
      });
      afterAll(async () => {
        await test_client.from("BALLOTS").delete().eq("user_id", test_id);
        await test_client.from("BALLOTS").delete().eq("telegram_id", "test2");
        await test_client.from("USERS").delete().eq("telegram_id", "test2");
      });
      it("ballots a slot", async () => {
        return expect(
          test_database
            .addBallot(
              "test",
              new Date("2000-01-01T13:00:00+0000"),
              new Date("2000-01-01T14:00:00+0000")
            )
            .then((result) => "ok")
        ).resolves.toEqual("ok");
      });
      it("other user can also ballot a slot balloted by someone else", async () => {
        return expect(
          test_database
            .addBallot(
              "test2",
              new Date("2000-01-01T12:00:00+0000"),
              new Date("2000-01-01T13:00:00+0000")
            )
            .then((result) => "ok")
        ).resolves.toEqual("ok");
      });
      it("is unable to ballot a slot they has already balloted", async () => {
        return expect(
          test_database
            .addBallot(
              "test",
              new Date("2000-01-01T12:20:00+0000"),
              new Date("2000-01-01T12:50:00+0000")
            )
            .then((result) => "ok")
        ).rejects.toThrowError();
      });
      it("returns error if startTime > endTime", async () => {
        return expect(
          test_database
            .addBallot(
              "test",
              new Date("2000-01-01T14:00:00+0000"),
              new Date("2000-01-01T13:00:00+0000")
            )
            .then((result) => "ok")
        ).rejects.toThrowError();
      });
      it("returns error if startTime = endTime", async () => {
        return expect(
          test_database
            .addBallot(
              "test",
              new Date("2000-01-01T13:00:00+0000"),
              new Date("2000-01-01T13:00:00+0000")
            )
            .then((result) => "ok")
        ).rejects.toThrowError();
      });
      it("returns an error booking a slot for a nonexistent user", async () => {
        return expect(
          test_database
            .addBallot(
              "i-don't-exist",
              new Date("2000-01-01T13:00:00+0000"),
              new Date("2000-01-01T14:00:00+0000")
            )
            .then((result) => "ok")
        ).rejects.toThrowError();
      });
    });
    describe("delBallot method", () => {
      afterAll(async () => {
        await test_client.from("BALLOTS").delete().eq("user_id", test_id);
      });
      it("deletes a booked slot", async () => {
        await test_database.addBallot(
          "test",
          new Date("2000-01-01T12:00:00+0000"),
          new Date("2000-01-01T13:00:00+0000")
        );
        return expect(
          test_database
            .delBallot({
              userTelegramId: "test",
              startTime: "2000-01-01T12:00:00+0000",
              endTime: "2000-01-01T13:00:00+0000",
            })
            .then((result) => "ok")
        ).resolves.toEqual("ok");
      });
      it("does nothing if no slots match", async () => {
        return expect(
          test_database
            .delBallot({
              userTelegramId: "test",
              startTime: "2000-01-01T00:00:00+0000",
              endTime: "2000-01-01T01:00:00+0000",
            })
            .then((result) => "ok")
        ).resolves.toEqual("ok");
      });
      it("returns an error attempting to delete a slot for a nonexistent user", async () => {
        return expect(
          test_database
            .delBallot({
              userTelegramId: "i-don't-exist",
              startTime: "2000-01-01T00:00:00+0000",
              endTime: "2000-01-01T01:00:00+0000",
            })
            .then((result) => "ok")
        ).rejects.toThrowError();
      });
    });
    describe("getBallotsByTime method", () => {
      afterAll(async () => {
        await test_client.from("BALLOTS").delete().eq("user_id", test_id);
      });
      beforeAll(async () => {
        await test_database.addBallot(
          "test",
          new Date("2000-01-02T00:00:00+0000"),
          new Date("2000-01-02T01:00:00+0000")
        );
        await test_database.addBallot(
          "test",
          new Date("2000-01-05T12:00:00+0000"),
          new Date("2000-01-05T13:00:00+0000")
        );
        await test_database.addBallot(
          "test",
          new Date("2000-01-07T12:00:00+0000"),
          new Date("2000-01-07T13:00:00+0000")
        );
      });
      it("gets only 2 balloted slots in the range", async () => {
        return expect(
          test_database
            .getBallotsByTime(
              new Date("2000-01-01T12:00:00+0000"),
              new Date("2000-01-06T13:00:00+0000")
            )
            .then((result) => result.length)
        ).resolves.toEqual(2);
      });
    });
    describe("delBallotsByTime method", () => {
      afterAll(async () => {
        await test_client.from("BALLOTS").delete().eq("user_id", test_id);
      });
      beforeAll(async () => {
        await test_database.addBallot(
          "test",
          new Date("2000-01-02T00:00:00+0000"),
          new Date("2000-01-02T01:00:00+0000")
        );
        await test_database.addBallot(
          "test",
          new Date("2000-01-05T12:00:00+0000"),
          new Date("2000-01-05T13:00:00+0000")
        );
        await test_database.addBallot(
          "test",
          new Date("2000-01-07T12:00:00+0000"),
          new Date("2000-01-07T13:00:00+0000")
        );
      });
      it("deletes only balloted slots in the range", async () => {
        await test_database.delBallotsByTime(
          new Date("2000-01-01T12:00:00+0000"),
          new Date("2000-01-04T13:00:00+0000")
        );
        return expect(
          test_database
            .getBallotsByTime(
              new Date("2000-01-07T12:00:00+0000"),
              new Date("2000-01-08T13:00:00+0000")
            )
            .then((result) => result.length)
        ).resolves.toEqual(1);
      });
    });
    describe("getBallotsFromUser method", () => {
      afterAll(async () => {
        await test_client.from("BALLOTS").delete().eq("user_id", test_id);
      });
      beforeAll(async () => {
        await test_database.addBallot(
          "test",
          new Date("2000-01-02T00:00:00+0000"),
          new Date("2000-01-02T01:00:00+0000")
        );
        await test_database.addBallot(
          "test",
          new Date("2000-01-05T12:00:00+0000"),
          new Date("2000-01-05T13:00:00+0000")
        );
        await test_database.addBallot(
          "test",
          new Date("2000-01-07T12:00:00+0000"),
          new Date("2000-01-07T13:00:00+0000")
        );
      });
      it("retrieves the 3 ballots belonging to our user", async () => {
        return expect(
          test_database
            .getBallotsFromUser("test")
            .then((result) => result.length)
        ).resolves.toEqual(3);
      });
      it("throws an error on attempting to access nonexistent user", async () => {
        return expect(
          test_database
            .getBallotsFromUser("don't-exist")
            .then((result) => result.length)
        ).rejects.toThrowError("There is no user with that telegram ID!");
      });
    });
  });
});
