import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { Database } from "../supabase_types";
import { Result, Ok, Err } from "@sniptt/monads";

export type User = Database["public"]["Tables"]["USERS"]["Row"];
export type Slot = Database["public"]["Tables"]["SLOTS"]["Row"];
export type Ballot = Database["public"]["Tables"]["BALLOTS"]["Row"];

/**
 * A class that holds the Supabase SQL database.
 * Dplatform programs do not interface with the
 * client directly, but instead use this class.
 *
 * In the future (after Milestone 1), this class
 * is planned to interface diretly with NUS venue API.
 */
export class DDatabase {
  /** The Supabase client. */
  private readonly client: SupabaseClient;

  /**
   * A private constructor for DDatabase.
   *
   * @param client Supabase Client
   * @param options Additional options, included for future extensions
   */
  private constructor(client: SupabaseClient, options: object) {
    this.client = client;
  }

  /**
   * Asynchronous factory method to create DDatabase instances.
   * Will reject invalid Supabase Client data.
   *
   * @param options Options given to the DDatabase instance
   * @param options.supabaseUrl URL for Supabase database
   * @param options.supabaseKey The public anonymous key
   * @returns A validated DDatabase instance
   * @throws Error if either URL or key is invalid
   */
  public static async build(options: {
    supabaseUrl: string;
    supabaseKey: string;
  }): Promise<DDatabase> {
    const { supabaseUrl, supabaseKey, ...classOptions } = options;
    const client = createClient<Database>(supabaseUrl, supabaseKey);

    // Test the given client
    // 1. It must be a valid Supabase client
    // 2. It must contain Dplatform data.
    //    We verify this by looking for the
    //    presence of the SLOTS table.
    return (
      client
        .from("SLOTS")
        .select("*")
        .then((query) => {
          if (query.error) {
            // If the error message exists,
            // format it into a JS error
            throw new Error(query.error.message);
          }
        })
        // If there is no error, we store a new
        // DDatabase instance in the promise
        .then((_) => new DDatabase(client, classOptions))
    );
  }

  /**
   * Checks whether a given telegram ID represents
   * a user already in the system.
   *
   * @param telegramId A telegram ID
   * @returns Whether the user is already in the system
   * @throws Error, if the system is already in an invalid state
   *         (Invariant violated - multiple usage of ID in the system)
   */
  public async isUser(telegramId: string): Promise<boolean> {
    return this.client
      .from("USERS")
      .select("*")
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      })
      .then((data) => {
        if (data.length > 1) {
          throw new Error(
            "Illegal State: There are several users that share a telegram account!"
          );
        }
        return data.length > 0;
      });
  }

  /**
   * Adds a user to the system.
   *
   * @param newUser A set of fields needed to represent a user
   * @param newUser.name User's name
   * @param newUser.telegramId User's Telegram ID
   * @param newUser.nusEmail User's NUS email
   * @param newUser.room User's RC room
   * @returns A result instance representing nothing or an error
   *          if insertion of user fails
   */
  public async addUser(newUser: {
    name: string;
    telegramId: string;
    nusEmail: string;
    room: string;
  }): Promise<Result<void, Error>> {
    return this.isUser(newUser.telegramId).then((added) =>
      added
        ? Err(new Error("There exists a user with the same account!"))
        : this.client
            .from("USERS")
            .insert({
              name: newUser.name,
              telegram_id: newUser.telegramId,
              nus_email: newUser.nusEmail,
              room: newUser.room,
            })
            .then((response) =>
              response.error
                ? Err(new Error(response.error.message))
                : Ok(undefined)
            )
    );
  }

  /**
   * Deletes a user from the system.
   *
   * @param telegramId User's Telegram ID
   * @returns A result instance representing nothing or an error
   *          if deletion of user fails
   */
  public async delUser(telegramId: string): Promise<Result<void, Error>> {
    return this.isUser(telegramId).then((added) =>
      added
        ? this.client
            .from("USERS")
            .delete()
            .eq("telegram_id", telegramId)
            .then((response) =>
              response.error
                ? Err(new Error(response.error.message))
                : Ok(undefined)
            )
        : Err(new Error("There is no user with that telegram ID!"))
    );
  }

  /**
   * Gets a user's system ID.
   * Useful method for methods using SLOTS table
   *
   * @param telegramId User's Telegram ID
   * @returns A result instance representing the system ID
   *          or an error if query fails
   */
  public async getUserId(telegramId: string): Promise<Result<number, Error>> {
    return this.isUser(telegramId).then((added) =>
      added
        ? this.client
            .from("USERS")
            .select("id")
            .eq("telegram_id", telegramId)
            .then((response) =>
              response.error
                ? Err(new Error(response.error.message))
                : // Safe to select array position [0], as
                  // 1. We have already verified that the user exists
                  // 2. An invariant that the database fulfills is that
                  //    all users' accounts are unique
                  Ok(response.data[0].id)
            )
        : Err(new Error("There is no user with that telegram ID!"))
    );
  }

  /**
   * Validates the datetimetz strings given to our booking functions
   * by checking that startTime is earlier than endTime.
   *
   * @param startTime Start time
   * @param endTime End time
   * @returns Whether start time is strictly before end time
   */
  private validateTime(startTime: string, endTime: string): boolean {
    return new Date(startTime) < new Date(endTime);
  }

  /**
   * Determines whether a period of time is not booked;
   * ie. a user may book the entirety of the queried
   * time
   *
   * @param startTime When the query starts checking from
   * @param endTime When the query stops checking from
   * @returns Whether the entire time is free
   * @throws Error on malformed input (startTime >= endTime)
   *         Error on unexpected database call failure
   */
  public async isBooked(startTime: string, endTime: string): Promise<boolean> {
    if (!this.validateTime(startTime, endTime)) {
      throw new Error("Start time must strictly be before end time!");
    }
    return this.client
      .from("SLOTS")
      .select("*")
      .lt("time_begin", endTime)
      .gt("time_end", startTime)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      })
      .then((data) => data.length > 0);
  }

  /**
   * Books a slot.
   *
   * @param booking A set of fields needed to represent a booking
   * @param booking.userTelegramId User's telegram ID
   * @param booking.startTime Desired start time
   * @param booking.endTime Desired end time
   * @returns A result instance representing nothing or an error
   *          if insertion of booking fails
   */
  public async bookSlot(booking: {
    userTelegramId: string;
    startTime: string;
    endTime: string;
  }): Promise<Result<void, Error>> {
    const userId = await this.getUserId(booking.userTelegramId);
    if (userId.isErr()) {
      // Safe to cast, as we have determined that
      // this is an error instance,
      return userId as Result<never, Error>;
    }
    if (!this.validateTime(booking.startTime, booking.endTime)) {
      return Err(new Error("Start time must strictly be before end time!"));
    }
    return this.isBooked(booking.startTime, booking.endTime).then((booked) =>
      booked
        ? Err(
            new Error(
              "Unable to book the entire slot, part/all of it is already booked"
            )
          )
        : this.client
            .from("SLOTS")
            .insert({
              // Safe, as userId was previously
              // determined to be Ok()
              booked_by: userId.unwrap(),
              time_begin: booking.startTime,
              time_end: booking.endTime,
            })
            .then((response) =>
              response.error
                ? Err(new Error(response.error.message))
                : Ok(undefined)
            )
    );
  }

  /**
   * Removes a booking.
   *
   * @param booking A set of fields needed to represent a booking
   * @param booking.userTelegramId User's telegram ID
   * @param booking.startTime Desired start time
   * @param booking.endTime Desired end time
   * @returns A result instance representing nothing or an error
   *          if deletion of booking fails
   */
  public async delSlot(booking: {
    userTelegramId: string;
    startTime: string;
    endTime: string;
  }): Promise<Result<void, Error>> {
    const userId = await this.getUserId(booking.userTelegramId);
    if (userId.isErr()) {
      // Safe to cast, as we have determined that
      // this is an error instance,
      return userId as Result<never, Error>;
    }
    return this.client
      .from("SLOTS")
      .delete()
      .eq("booked_by", userId.unwrap())
      .eq("time_begin", booking.startTime)
      .eq("time_end", booking.endTime)
      .then((response) =>
        response.error ? Err(new Error(response.error.message)) : Ok(undefined)
      );
  }

  /**
   * Provides all booked slots associated to one user.
   *
   * @param telegramId User's Telegram ID
   * @returns A result instance representing set
   *          of all bookings or an error if query fails
   */
  public async getSlotsByUser(telegramId: string): Promise<Slot[]> {
    const userId = await this.getUserId(telegramId);
    if (userId.isErr()) {
      // Safe to cast, as we have determined that
      // this is an error instance,
      throw userId.unwrapErr();
    }
    return this.client
      .from("SLOTS")
      .select()
      .eq("booked_by", userId.unwrap())
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      });
  }

  public async getSlotsByTime(startTime: Date, endTime: Date): Promise<Slot[]> {
    return this.client
      .from("SLOTS")
      .select("*")
      .gte("time_begin", startTime.toISOString())
      .lt("time_end", endTime.toISOString())
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      });
  }

  public async getUserEmail(telegramId: string): Promise<string | null> {
    return this.client
      .from("USERS")
      .select("nus_email")
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const userData = response.data;
        if (userData.length > 0) {
          return userData[0].nus_email;
        }
        return null;
      });
  }

  public async getUserById(id: number): Promise<string | null> {
    return this.client
      .from("USERS")
      .select("name")
      .eq("id", id)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const userData = response.data;
        if (userData.length > 0) {
          return userData[0].name;
        }
        return null;
      });
  }

  public async saveVerificationCode(
    telegramId: string,
    verificationCode: string
  ): Promise<void> {
    return this.client
      .from("USERS")
      .update({ verification_code: verificationCode })
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }

  public async getVerificationCode(telegramId: string): Promise<string | null> {
    return this.client
      .from("USERS")
      .select("verification_code")
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const userData = response.data;
        if (userData.length > 0) {
          return userData[0].verification_code;
        }
        return null;
      });
  }

  //check if user is registered
  public async isRegistered(telegramId: string): Promise<boolean> {
    return this.client
      .from("USERS")
      .select("telegram_id")
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const userData = response.data;
        if (userData.length > 0) {
          return true;
        }
        return false;
      });
  }

  public async isVerified(telegramId: string): Promise<boolean> {
    return this.client
      .from("USERS")
      .select("is_auth")
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const userData = response.data;
        if (userData.length > 0) {
          return userData[0].is_auth;
        }
        return false;
      });
  }
  public async markUserAsVerified(telegramId: string): Promise<void> {
    return this.client
      .from("USERS")
      .update({ is_auth: true })
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }

  /**
   * Determines whether a period of time is not balloted by a user;
   * ie. a user may ballot the entirety of the queried
   * time
   *
   * @param startTime When the query starts checking from
   * @param endTime When the query stops checking from
   * @returns Whether the entire time is free
   * @throws Error on malformed input (startTime >= endTime)
   *         Error on unexpected database call failure
   */
  public async isBalloted(
    telegramId: string,
    startTime: string,
    endTime: string
  ): Promise<boolean> {
    if (!this.validateTime(startTime, endTime)) {
      throw new Error("Start time must strictly be before end time!");
    }
    return this.client
      .from("BALLOTS")
      .select("*")
      .lt("time_begin", endTime)
      .gt("time_end", startTime)
      .eq("telegram_id", telegramId)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      })
      .then((data) => data.length > 0);
  }

  public async addBallot(
    telegramId: string,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    const userId = await this.getUserId(telegramId);
    const balloted = await this.isBalloted(
      telegramId,
      startTime.toISOString(),
      endTime.toISOString()
    );
    if (userId.isErr()) {
      // Safe to cast, as we have determined that
      // this is an error instance,
      throw userId.unwrapErr();
    }
    if (balloted) {
      throw new Error("Slot is already balloted!");
    }
    if (startTime >= endTime) {
      throw new Error("Start time must strictly be before end time!");
    }
    return this.client
      .from("BALLOTS")
      .insert({
        telegram_id: telegramId,
        user_id: userId.unwrap(),
        time_begin: startTime.toISOString(),
        time_end: endTime.toISOString(),
      })
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }

  public async delBallot(ballot: {
    userTelegramId: string;
    startTime: string;
    endTime: string;
  }): Promise<void> {
    const userId = await this.getUserId(ballot.userTelegramId);
    if (userId.isErr()) {
      // Safe to cast, as we have determined that
      // this is an error instance,
      throw userId.unwrapErr();
    }
    return this.client
      .from("BALLOTS")
      .delete()
      .eq("user_id", userId.unwrap())
      .eq("time_begin", ballot.startTime)
      .eq("time_end", ballot.endTime)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }

  public async getBallotsByTime(
    startTime: Date,
    endTime: Date
  ): Promise<Ballot[]> {
    return this.client
      .from("BALLOTS")
      .select("*")
      .gte("time_begin", startTime.toISOString())
      .lt("time_end", endTime.toISOString())
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      });
  }

  public async delBallotsByTime(startTime: Date, endTime: Date): Promise<void> {
    return this.client
      .from("BALLOTS")
      .select()
      .gte("time_begin", startTime.toISOString())
      .lt("time_end", endTime.toISOString())
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }

  public async getBallotsFromUser(telegramId: string): Promise<Ballot[]> {
    const userId = await this.getUserId(telegramId);
    if (userId.isErr()) {
      // Safe to cast, as we have determined that
      // this is an error instance,
      throw userId.unwrapErr();
    }
    return this.client
      .from("BALLOTS")
      .select("*")
      .eq("user_id", userId.unwrap())
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        return response.data;
      });
  }
  public async getAllBookedSlotsSe(start: Date, end: Date): Promise<Slot[]> {
    // Convert the start and end dates to ISO 8601 format
    const startTime = start.toISOString();
    const endTime = end.toISOString();

    return this.client
      .from("SLOTS")
      .select("*")
      .gte("time_begin", startTime)
      .lte("time_end", endTime)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }

        // Return the response data directly
        return response.data as Slot[];
      });
  }

  public async getAllBallotsSe(start: Date, end: Date): Promise<Ballot[]> {
    // Convert the start and end dates to ISO 8601 format
    const startTime = start.toISOString();
    const endTime = end.toISOString();

    return this.client
      .from("BALLOTS")
      .select("*")
      .gte("time_begin", startTime)
      .lte("time_end", endTime)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }

        // Return the response data directly
        return response.data as Ballot[];
      });
  }
  public async getAllBookedSlots(): Promise<Slot[]> {
    // Get the current date-time in ISO 8601 format
    const currentTime = new Date().toISOString();
    return this.client
      .from("SLOTS")
      .select("*")
      .gte("time_begin", currentTime)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }

        // Return the response data directly
        return response.data;
      });
  }

  public async getAllBallots(): Promise<Ballot[]> {
    // Get the current date-time in ISO 8601 format
    const currentTime = new Date().toISOString();
    return this.client
      .from("BALLOTS")
      .select("*")
      .gte("time_begin", currentTime)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }

        // Return the response data directly
        return response.data;
      });
  }
  public async getBallotsByUser(telegramId: string): Promise<Ballot[]> {
    const currentDateTime = new Date().toISOString();
    try {
      const userId = await this.getUserId(telegramId);
      if (!userId) {
        throw new Error("User ID not found");
      }

      const response = await this.client
        .from("BALLOTS")
        .select("*")
        .eq("user_id", userId.unwrap())
        .gte("time_begin", currentDateTime);

      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    } catch (error) {
      // You might want to do more with the error here, like logging it
      throw error;
    }
  }
  public async getBookedSlotsByUser(telegramId: string): Promise<Slot[]> {
    const currentDateTime = new Date().toISOString();
    try {
      const userId = await this.getUserId(telegramId);
      if (!userId) {
        throw new Error("User ID not found");
      }

      const response = await this.client
        .from("SLOTS")
        .select("*")
        .eq("booked_by", userId.unwrap())
        .gte("time_begin", currentDateTime);

      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    } catch (error) {
      // You might want to do more with the error here, like logging it
      throw error;
    }
  }
  public async getBallotById(id: number): Promise<Ballot | null> {
    return this.client
      .from("BALLOTS")
      .select("*")
      .eq("id", id)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const ballotData = response.data;
        if (ballotData.length > 0) {
          return ballotData[0];
        }
        return null;
      });
  }
  public async getBookingById(id: number): Promise<Slot | null> {
    return this.client
      .from("SLOTS")
      .select("*")
      .eq("id", id)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
        const bookingData = response.data;
        if (bookingData.length > 0) {
          return bookingData[0];
        }
        return null;
      });
  }

  public async deleteBookingById(id: number): Promise<void> {
    return this.client
      .from("SLOTS")
      .delete()
      .eq("id", id)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }

  public async deleteBallotById(id: number): Promise<void> {
    return this.client
      .from("BALLOTS")
      .delete()
      .eq("id", id)
      .then((response) => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      });
  }
}
