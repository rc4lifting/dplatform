import { Telegraf, Context, Scenes, Composer, session, Markup } from "telegraf";
import { EmailVerifier } from "../email/email";
import { addDays, weekStart } from "../timeutils";
import { DDatabase } from "../database/d-database";
import { WizardContext, WizardScene } from "telegraf/typings/scenes";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { LiveUpdater } from "../live_updater/live_updater";
import { CronJob } from "cron";
import { DManager } from "../dmanager";
import Config from "../config/config";
import {
  startOfWeek,
  endOfWeek,
  addMinutes,
  isBefore,
  formatISO,
  eachDayOfInterval,
  addWeeks,
} from "date-fns";
import { format, utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";

interface MyWizardSession extends Scenes.WizardSessionData {
  // will be available under `ctx.scene.session.myWizardSessionProp`
  name: string;
  email: string;
  room_no: string;
}

type MyContext = Scenes.WizardContext<MyWizardSession>;
//https://github.com/feathers-studio/telegraf-docs/blob/master/examples/wizards/wizard-with-custom-scene-session.ts
//const nameStepHandler = new Composer<Scenes.WizardContext>();
export class TelegramBot {
  private bot: Telegraf<MyContext>;
  private verifier: EmailVerifier;
  private database: DDatabase;
  private updater: LiveUpdater;
  private manager: DManager;

  constructor(
    botToken: string,
    apiKey: string,
    supabaseUrl: string,
    supabaseKey: string,
    googleServiceAccountEmail: string,
    googleServiceAccountPrivateKey: string,
    googleSpreadsheetId: string
  ) {
    this.bot = new Telegraf<MyContext>(botToken);
    this.verifier = null!;
    this.database = null!;
    this.updater = null!;
    this.manager = null!;

    (async (bot) => {
      try {
        this.updater = new LiveUpdater(
          googleServiceAccountEmail,
          googleServiceAccountPrivateKey,
          googleSpreadsheetId,
          supabaseUrl,
          supabaseKey
        );
        //TODO initialise this better
        this.database = null!;
        await this.updater.init();
        await this.initializeDatabase(supabaseUrl, supabaseKey);
        await this.initializeVerifier(apiKey);
        await this.setupCommands();
        this.manager = new DManager(this.database);
        // Start the bot
        bot
          .launch()
          .then(() => {
            console.log("Bot started");
          })
          .catch((err) => {
            console.error("Error starting bot", err);
          });
        console.log("Bot started");
      } catch (error) {
        console.error("Error during initialization:", error);
      }
    })(this.bot);

    const job = new CronJob(
      "0 0 12 * * 0",
      async () => {
        try {
          await this.manager.resolve();
        } catch (err) {
          console.error(err);
        }
      },
      null,
      true,
      "Asia/Singapore"
    );

    const job2 = new CronJob(
      "*/15 * * * *",
      async () => {
        try {
          await this.updater.updateSheets();
        } catch (err) {
          console.error(err);
        }
      },
      null,
      true,
      "Asia/Singapore"
    );

    job.start();
    job2.start;
  }

  private async initializeDatabase(
    supabaseUrl: string,
    supabaseKey: string
  ): Promise<void> {
    try {
      this.database = await DDatabase.build({ supabaseUrl, supabaseKey });
    } catch (error) {
      console.error("Error creating DDatabase instance:", error);
    }
  }

  private async initializeVerifier(apiKey: string): Promise<void> {
    try {
      this.verifier = await EmailVerifier.build(apiKey);
    } catch (error) {
      console.error("Error creating EmailVerifier instance:", error);
    }
  }

  private async setupCommands(): Promise<void> {
    // Command handler: Start the bot

    const checkRegistrationAndVerification =
      () => async (ctx: Context, next: () => Promise<void>) => {
        const telegramId = ctx.from!.id.toString();

        // Check if registered
        const isRegistered = await this.database.isRegistered(telegramId);
        if (!isRegistered) {
          return ctx.reply(
            "You are not registered. Please run /register to register."
          );
        }

        // Check if verified
        const isVerified = await this.database.isVerified(telegramId);
        if (!isVerified) {
          return ctx.reply(
            "You are not verified. Please run /get_code to get a verification code sent to your email address."
          );
        }

        // Pass control to the next middleware
        return next();
      };

    //make a middleware that checks if it's private message and from person with actual telegram id

    // Command handler: Show help message
    this.bot.command("start", (ctx) => {
      const startMessage = `
        Welcome to the Telegram Bot!
  
        Available commands:
        /start - Start the bot
        /help - Show the help message
        /register - Register for the bot
        /verify - Verify your email address
        /unregister - Unregister and delete your data
  
        To begin registration, use the /register command.
        Follow the instructions provided by the bot to complete the registration process.
        Once registered, use the /verify command to verify your email address.
        You can also use the /unregister command to unregister from the bot and delete your data.
      `;
      ctx.reply(startMessage);
    });
    // Command handler: Show help message
    this.bot.command("help", (ctx) => {
      const helpMessage = `
        This is a custom bot that provides various commands.
  
        Available commands:
        /start - Start the bot
        /help - Show the help message
        /register - Register for the bot
        /verify - Verify your email address
        /unregister - Unregister and delete your data
        /book - Book a slot for the current Monday - Sunday cycle
        /ballot - Ballot for a slot in the coming Monday - Sunday cycle
        /view_sheets - View the spreadsheet for live updates on booking
  
        To begin registration, use the /register command.
        Follow the instructions provided by the bot to complete the registration process.
        Once registered, use the /verify command to verify your email address.
        You can also use the /unregister command to unregister from the bot and delete your data.
      `;
      ctx.reply(helpMessage);
    });

    //make a /sheets command that gives this link https://docs.google.com/spreadsheets/d/1FdeYnZ1qHDMvqq58ZGInVafLmzI6rpnxKLsB2sAqwwc/edit#gid=0
    this.bot.command("view_sheets", (ctx) => {
      const sheetsMessage = `
        This is the link to the spreadsheet:
        https://docs.google.com/spreadsheets/d/1FdeYnZ1qHDMvqq58ZGInVafLmzI6rpnxKLsB2sAqwwc/edit#gid=0
      `;
      ctx.reply(sheetsMessage);
    });

    // https://github.com/telegraf/telegraf/issues/705

    const nameStepHandler = new Composer<MyContext>();

    nameStepHandler.on("text", async (ctx) => {
      if (ctx.message!.text.length < 3) {
        console.log("name is invalid");
        await ctx.reply("Please enter a valid name.");
        return;
      }
      console.log("name is valid");
      ctx.scene.session.name = ctx.message.text;
      await ctx.reply("Please enter your NUS email.");
      return ctx.wizard.next();
    });

    const emailStepHandler = new Composer<MyContext>();
    emailStepHandler.on("text", async (ctx) => {
      const email = ctx.message.text;
      const emailRegex = /^[A-Za-z0-9._%+-]+@u\.nus\.edu$/;
      if (!emailRegex.test(email)) {
        await ctx.reply(
          "Please enter a valid NUS email address (e.g., XXX@u.nus.edu)."
        );
        return;
      }
      ctx.scene.session.email = email;
      await ctx.reply("Please enter your room number.");
      return ctx.wizard.next();
    });
    const roomStepHandler = new Composer<MyContext>();
    roomStepHandler.on("text", async (ctx) => {
      const room = ctx.message.text;
      console.log(ctx.message.text);
      if (room.length < 3) {
        console.log("room is invalid");
        await ctx.reply("Please enter a valid room.");
        return;
      }
      ctx.scene.session.room_no = room;
      //reply all ctx scene
      //reply with his data formatted
      console.log("room is valid");
      const confirm_string = `Your name is ${ctx.scene.session.name}, your email is ${ctx.scene.session.email} and your room is ${ctx.scene.session.room_no}.`;
      //add to database
      const telegramId = ctx.message!.from!.id.toString();
      //create a user as a json object
      const user = {
        name: ctx.scene.session.name,
        telegramId: telegramId,

        nusEmail: ctx.scene.session.email,
        room: ctx.scene.session.room_no,
      };
      await this.database.addUser(user);
      await ctx.reply(confirm_string);
      await ctx.reply(
        "Please run /get_code to get a verification code sent your email address and finish your registration."
      );
      return ctx.scene.leave();
    });

    // Setup the registration wizard
    const registrationWizard = new Scenes.WizardScene(
      "registration",
      async (ctx) => {
        //const name = await ctx.reply(ctx.message.text);
        //check if alreayd registered
        const telegramId = ctx.message!.from!.id.toString();
        const isRegistered = await this.database.isRegistered(telegramId);
        const isVerified = await this.database.isVerified(telegramId);
        //log isRegistered, isVerified
        console.log("isRegistered: ", isRegistered);
        console.log("isVerified: ", isVerified);
        console.log("telegramId: ", telegramId);
        if (isRegistered) {
          await ctx.reply("You have already registered.");
          if (isVerified) {
            await ctx.reply("You have also already verified your email.");
          } else {
            await ctx.reply(
              "However, you have not verified your email. Please run /get_code to get a verification code for your email address."
            );
          }
          return ctx.scene.leave();
        }
        await ctx.reply("Please enter your name:");
        //console log this
        return ctx.wizard.next();
      },
      nameStepHandler,
      emailStepHandler,
      roomStepHandler
    );

    const stage = new Scenes.Stage<MyContext>([registrationWizard], {});
    this.bot.use(session());
    this.bot.use(stage.middleware());
    this.bot.command("register", (ctx) => ctx.scene.enter("registration"));
    // Command handler: Verify email address with code
    this.bot.command("verify", async (ctx) => {
      const telegramId = ctx.from!.id.toString();
      const isRegistered = await this.database.isRegistered(telegramId);
      if (!isRegistered) {
        ctx.reply("You are not registered. Please run /register to register.");
        return;
      }

      const isVerified = await this.database.isVerified(telegramId);
      if (isVerified) {
        ctx.reply("You are already verified.");
        return;
      }

      const verificationCode = ctx.message.text.split(" ")[1];
      if (!verificationCode) {
        ctx.reply("Please provide a verification code. Usage: /verify {CODE}");
        return;
      }

      const storedVerificationCode = await this.database.getVerificationCode(
        telegramId
      );
      if (!storedVerificationCode) {
        ctx.reply(
          "No verification code found. Please generate a new verification code via /get_code."
        );
        return;
      }

      if (verificationCode !== storedVerificationCode) {
        ctx.reply("Invalid verification code. Please try again.");
        return;
      }

      try {
        await this.database.markUserAsVerified(telegramId);
        ctx.reply("Email address verified successfully!");
        const helpMessage = `
        Once again, here are the available commands:
  
        /start - Start the bot
        /help - Show the help message
        /register - Register for the bot
        /verify - Verify your email address
        /unregister - Unregister and delete your data
        /book - Book a slot for the current Monday - Sunday cycle
        /ballot - Ballot for a slot in the coming Monday - Sunday cycle
        /view_sheets - View the spreadsheet for live updates on booking
  
        You have already been registered and verified.
        You can also use the /unregister command to unregister from the bot and delete your data.
      `;
        ctx.reply(helpMessage);
      } catch (error) {
        console.error("Error marking user as verified:", error);
        ctx.reply("An error occurred while marking the user as verified.");
      }
    });
    // Command handler: Unregister and delete user data
    this.bot.command(
      "unregister",
      checkRegistrationAndVerification(),
      async (ctx) => {
        const telegramId = ctx.from!.id.toString();

        try {
          await this.database.delUser(telegramId);
          ctx.reply(
            "You have been unregistered and your data has been deleted."
          );
        } catch (error) {
          console.error("Error unregistering user:", error);
          ctx.reply("An error occurred while unregistering.");
        }
      }
    );
    /**
     * generateTimeSlots function generates an array of ISO string representations of time slot pairs.
     * It starts from a given start date/time and increments by a given interval (in minutes) until it reaches the end date/time.
     *
     * @param {Date} start - The start date/time of the time slots.
     * @param {Date} end - The end date/time of the time slots.
     * @param {number} interval - The interval (in minutes) between each time slot.
     * @return {string[][]} An array of time slot pairs in ISO string format.
     */
    const generateTimeSlots = (
      start: Date,
      end: Date,
      interval: number
    ): Date[][] => {
      const slots: Date[][] = [];
      let currentStart = start;

      while (isBefore(currentStart, end)) {
        const currentEnd = addMinutes(currentStart, interval);
        if (isBefore(currentEnd, end)) {
          slots.push([currentStart, currentEnd]);
        }
        currentStart = currentEnd;
      }

      return slots;
    };

    // Helper function to generate the dates for the ith week
    const generateDates = (weekOffset = 0) => {
      // Ensure that weekOffset is an integer.
      weekOffset = Math.floor(weekOffset);

      // Add weekOffset to the current date
      const currentDate = addWeeks(new Date(), weekOffset);

      const startOfWeekDate = startOfWeek(currentDate, { weekStartsOn: 1 }); // 1 for Monday as first day of week
      const endOfWeekDate = endOfWeek(currentDate, { weekStartsOn: 1 });

      const weekInterval = { start: startOfWeekDate, end: endOfWeekDate };
      const weekDates = eachDayOfInterval(weekInterval); // Gets dates for each day in the interval

      const dates: string[] = weekDates.map((date) => {
        const dateInUserTimezone = utcToZonedTime(date, "Asia/Singapore"); // Converts date to user's local timezone (GMT+8)
        return formatISO(dateInUserTimezone, { representation: "date" }); // Stores date as ISO string in dates array
      });

      return dates;
    };

    function utcToSGT(date: Date): string {
      const timeZone = "Asia/Singapore"; // GMT+8
      const dateInSGT = utcToZonedTime(date, timeZone);
      const timeString = format(dateInSGT, "HH:mm", { timeZone });
      return timeString;
    }

    // Command handler: ballot slot
    this.bot.command(
      "ballot",
      checkRegistrationAndVerification(),
      async (ctx) => {
        const dates = generateDates(1);
        //filter out the weekends
        const filteredDates = dates.filter((date) => {
          const day = new Date(date).getDay();
          return day !== 0 && day !== 6;
        });
        const buttons = filteredDates.map((date) => {
          const [year, month, day] = date.split("-");
          const formattedDate = new Date(date).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          });

          return [Markup.button.callback(formattedDate, `BALLOT_DATE ${date}`)];
        });
        ctx.reply("Select a date:", Markup.inlineKeyboard(buttons));
      }
    );

    this.bot.action(
      /^BALLOT_DATE (.+)/,
      checkRegistrationAndVerification(),
      (ctx) => {
        const date = ctx.match![1];

        //starting and ending are in gmt+8, convert to utc
        //convert date and set time to startTime, endTime, convert to utc
        const startTime = zonedTimeToUtc(
          `${date}T${config.startingTime}:00`,
          "Asia/Singapore"
        );
        const endTime = zonedTimeToUtc(
          `${date}T${config.endingTime}:00`,
          "Asia/Singapore"
        );
        const slots = generateTimeSlots(
          startTime,
          endTime,
          config.timeInterval
        );
        //filter for slots that are past time
        const buttons = [];
        for (let i = 0; i < config.rows; i++) {
          const row = [];
          for (let j = 0; j < config.columns; j++) {
            const index = i * config.columns + j;
            if (index < slots.length) {
              const slot = slots[index];

              row.push(
                Markup.button.callback(
                  `${utcToSGT(slot[0])}`,
                  `BALLOT_START_TIME ${slot[0].toISOString()}`
                )
              );
            }
          }
          buttons.push(row);
        }
        ctx.editMessageText(
          `You selected ${date}. Select a starting time:`,
          Markup.inlineKeyboard(buttons)
        );
      }
    );

    this.bot.action(
      /^BALLOT_START_TIME (.+)/,
      checkRegistrationAndVerification(),
      (ctx) => {
        const startTime = ctx.match![1];
        //convert startTime to date
        const startDate = new Date(startTime);
        //add the time in minutes from config
        const endDate = addMinutes(startDate, config.maxLength);
        const slots = generateTimeSlots(
          startDate,
          endDate,
          config.timeInterval
        );

        console.log(slots);
        //log the buttons
        const buttons = slots.map((slot) =>
          Markup.button.callback(
            `${utcToSGT(slot[1])}`,
            `BET ${startTime} ${slot[1].toISOString()}`
          )
        );
        console.log(buttons);

        ctx.editMessageText(
          `You selected ${startTime} as starting time. Select an ending time:`,
          Markup.inlineKeyboard(buttons)
        );
      }
    );

    this.bot.action(
      /^BET (.+) (.+)/,
      checkRegistrationAndVerification(),
      async (ctx) => {
        const startTime = ctx.match![1];
        const endTime = ctx.match![2];

        ctx.editMessageText(
          `You selected ${endTime} as ending time. Adding ballot from ${startTime} to ${endTime}.`
        );
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        try {
          // await this.database.addBallot(ctx.from!.id.toString(), start, end);
          // log the dates
          console.log("start: ", startTime);
          console.log("end: ", endTime);
          //TODO: use the ballot function
          await this.manager.ballot(
            ctx.from!.id.toString(),
            startDate,
            endDate
          );
          ctx.reply("Booking added to database.");
        } catch (error) {
          console.error("Error adding booking to database:", error);
          ctx.reply("An error occurred while adding booking to database.");
          ctx.reply("Error is " + error);
          return;
        }
      }
    );

    // Command handler: book slot
    this.bot.command(
      "book",
      checkRegistrationAndVerification(),
      async (ctx) => {
        const dates = generateDates(0);
        //filter out the weekends
        const filteredDates = dates.filter((date) => {
          const day = new Date(date).getDay();
          return day !== 0 && day !== 6;
        });
        const buttons = filteredDates.map((date) => {
          const [year, month, day] = date.split("-");
          const formattedDate = new Date(date).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          });

          return [Markup.button.callback(formattedDate, `BOD ${date}`)];
        });
        ctx.reply("Select a date:", Markup.inlineKeyboard(buttons));
      }
    );

    function utcToReadableString(utcDateString: string): string {
      const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "short", // "Jan", "Feb", etc.
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
        timeZone: "Asia/Singapore", // Adjusted for Singapore Time (SGT)
      };

      return new Intl.DateTimeFormat("en-SG", options).format(
        new Date(utcDateString)
      );
    }

    this.bot.command(
      "bookings",
      checkRegistrationAndVerification(),
      async (ctx) => {
        try {
          const userId = ctx.from!.id.toString();
          const ballots = await this.database.getBookedSlotsByUser(userId);

          // Check if the user has any bookings.
          if (!ballots.length) {
            return ctx.reply("You have no bookings.");
          }

          // Format each ballot.
          const formattedBallots = ballots.map((ballot, index) => {
            const start = utcToReadableString(ballot.time_begin);
            const end = utcToReadableString(ballot.time_end);
            return `${index + 1}) ${start} to ${end}`;
          });

          // Construct the reply message.
          const message = ["Here are your bookings:", ...formattedBallots].join(
            "\n"
          );

          ctx.reply(message);
        } catch (error) {
          // Consider adding error handling/logging here.
          ctx.reply("An error occurred. Please try again.");
        }
      }
    );

    this.bot.command(
      "ballots",
      checkRegistrationAndVerification(),
      async (ctx) => {
        try {
          const userId = ctx.from!.id.toString();
          const ballots = await this.database.getBallotsByUser(userId);

          // Check if the user has any bookings.
          if (!ballots.length) {
            return ctx.reply("You have no ballots.");
          }

          // Format each ballot.
          const formattedBallots = ballots.map((ballot, index) => {
            const start = utcToReadableString(ballot.time_begin);
            const end = utcToReadableString(ballot.time_end);
            return `${index + 1}) ${start} to ${end}`;
          });

          // Construct the reply message.
          const message = ["Here are your ballots:", ...formattedBallots].join(
            "\n"
          );

          ctx.reply(message);
        } catch (error) {
          // Consider adding error handling/logging here.
          ctx.reply("An error occurred. Please try again.");
        }
      }
    );
    this.bot.command(
      "deleteBooking",
      checkRegistrationAndVerification(),
      async (ctx) => {
        try {
          const userId = ctx.from!.id.toString();
          const bookings = await this.database.getBookedSlotsByUser(userId);

          // Check if there are no bookings.
          if (!bookings.length) {
            return ctx.reply("You have no bookings to delete.");
          }

          // Map bookings to readable format.
          const formattedBookings = bookings.map((booking, index) => {
            const start = utcToReadableString(booking.time_begin);
            const end = utcToReadableString(booking.time_end);
            return `${index + 1}) ${start} to ${end}`;
          });

          // Map bookings to callback buttons.
          const buttons = bookings.map((booking, index) => {
            return Markup.button.callback(
              `Delete ${index + 1}`,
              `DELETE_BOOKING ${booking.id}`
            );
          });

          // Construct the final message.
          const message = ["Current bookings:", ...formattedBookings].join(
            "\n"
          );

          ctx.reply(message, Markup.inlineKeyboard(buttons));
        } catch (error) {
          ctx.reply("An error occurred. Please try again.");
        }
      }
    );
    this.bot.action(
      /^DELETE_BOOKING (.+)/,
      checkRegistrationAndVerification(),
      async (ctx) => {
        try {
          const bookingId = parseInt(ctx.match![1]);
          const userId = (
            await this.database.getUserId(ctx.from!.id.toString())
          ).unwrap();
          //get booking
          const booking = await this.database.getBookingById(bookingId);
          //check if booking exists
          if (!booking) {
            return ctx.editMessageText("Booking does not exist.");
          }
          //check if booking belongs to user
          if (booking.booked_by !== userId) {
            return ctx.editMessageText("Booking does not belong to you.");
          }
          //delete booking
          await this.database.deleteBookingById(bookingId);
          ctx.editMessageText("Booking deleted.");
        } catch (error) {
          ctx.editMessageText("An error occurred. Please try again.");
        }
      }
    );
    this.bot.action(/^BOD (.+)/, checkRegistrationAndVerification(), (ctx) => {
      const date = ctx.match![1];

      //starting and ending are in gmt+8, convert to utc
      //convert date and set time to startTime, endTime, convert to utc
      const startTime = zonedTimeToUtc(
        `${date}T${config.startingTime}:00`,
        "Asia/Singapore"
      );
      const endTime = zonedTimeToUtc(
        `${date}T${config.endingTime}:00`,
        "Asia/Singapore"
      );
      const slots = generateTimeSlots(startTime, endTime, config.timeInterval);
      const filteredSlots = slots.filter((slot) => {
        return new Date(slot[1]) > new Date();
      });
      //filter for slots that are past time

      const buttons = [];
      for (let i = 0; i < config.rows; i++) {
        const row = [];
        for (let j = 0; j < config.columns; j++) {
          const index = i * config.columns + j;
          if (index < filteredSlots.length) {
            const slot = filteredSlots[index];

            row.push(
              Markup.button.callback(
                `${utcToSGT(slot[0])}`,
                `BOST ${slot[0].toISOString()}`
              )
            );
          }
        }
        buttons.push(row);
      }
      ctx.editMessageText(
        `You selected ${date}. Select a starting time:`,
        Markup.inlineKeyboard(buttons)
      );
    });

    this.bot.action(/^BOST (.+)/, checkRegistrationAndVerification(), (ctx) => {
      const startTime = ctx.match![1];
      //convert startTime to date
      const startDate = new Date(startTime);
      //add the time in minutes from config
      //TODO: EXCLUDE BOOKED SLOTS
      const endDate = addMinutes(startDate, config.maxLength);
      const slots = generateTimeSlots(startDate, endDate, config.timeInterval);
      const filteredSlots = slots.filter((slot) => {
        return new Date(slot[1]) > new Date();
      });

      //log the buttons
      const buttons = filteredSlots.map((slot) =>
        Markup.button.callback(
          `${utcToSGT(slot[1])}`,
          `BOET ${startTime} ${slot[1].toISOString()}`
        )
      );
      console.log(buttons);

      ctx.editMessageText(
        `You selected ${startTime} as starting time. Select an ending time:`,
        Markup.inlineKeyboard(buttons)
      );
    });

    this.bot.command(
      "deleteBallot",
      checkRegistrationAndVerification(),
      async (ctx) => {
        try {
          const userId = ctx.from!.id.toString();
          const ballots = await this.database.getBallotsByUser(userId);

          // Check if there are no bookings.
          if (!ballots.length) {
            return ctx.reply("You have no bookings to delete.");
          }

          // Map bookings to readable format.
          const formattedBookings = ballots.map((ballot, index) => {
            const start = utcToReadableString(ballot.time_begin);
            const end = utcToReadableString(ballot.time_end);
            return `${index + 1}) ${start} to ${end}`;
          });

          // Map bookings to callback buttons.
          const buttons = ballots.map((ballot, index) => {
            return Markup.button.callback(
              `Delete ${index + 1}`,
              `DELETE_BALLOT ${ballot.id}`
            );
          });

          // Construct the final message.
          const message = ["Current ballots:", ...formattedBookings].join("\n");

          ctx.reply(message, Markup.inlineKeyboard(buttons));
        } catch (error) {
          ctx.reply("An error occurred. Please try again.");
        }
      }
    );
    this.bot.action(
      /^DELETE_BALLOT (.+)/,
      checkRegistrationAndVerification(),
      async (ctx) => {
        try {
          const ballotId = parseInt(ctx.match![1]);
          const userId = (
            await this.database.getUserId(ctx.from!.id.toString())
          ).unwrap();
          //get booking
          const ballot = await this.database.getBallotById(ballotId);
          //check if booking exists
          if (!ballot) {
            return ctx.editMessageText("Ballot does not exist.");
          }
          //check if booking belongs to user
          if (ballot.user_id !== userId) {
            return ctx.editMessageText("Ballot does not belong to you.");
          }
          //delete booking
          await this.database.deleteBallotById(ballotId);
          ctx.editMessageText("Ballot deleted.");
        } catch (error) {
          ctx.editMessageText("An error occurred. Please try again.");
        }
      }
    );

    this.bot.action(
      /^BOET (.+) (.+)/,
      checkRegistrationAndVerification(),
      async (ctx) => {
        const startTime = ctx.match![1];
        const endTime = ctx.match![2];

        ctx.editMessageText(
          `You selected ${endTime} as ending time. Adding booking from ${startTime} to ${endTime}.`
        );
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        try {
          // await this.database.addBallot(ctx.from!.id.toString(), start, end);
          // log the dates
          console.log("start: ", startTime);
          console.log("end: ", endTime);
          //TODO: use the ballot function
          await this.manager.tryBook(
            ctx.from!.id.toString(),
            startDate,
            endDate
          );
          ctx.reply("Ballot added to database.");
        } catch (error) {
          console.error("Error adding ballot to database:", error);
          ctx.reply("An error occurred while adding ballot to database.");
          ctx.reply("Error is " + error);
          return;
        }
      }
    );

    //get_code
    this.bot.command("get_code", async (ctx) => {
      // Check if the user is already verified
      //const isVerified = await this.database.isVerified(telegramId);
      //get telegramId from context
      //check to see if database is init

      const telegramId = ctx.from!.id.toString();
      //try catch
      let isRegistered = false;
      try {
        isRegistered = await this.database.isRegistered(telegramId);
      } catch (error) {
        console.error("Error getting verification code:", error);
        ctx.reply("An error occurred while getting the verification code.");
        return;
      }
      //if not registered, ask them to register
      if (!isRegistered) {
        ctx.reply("You are not registered. Please run /register to register.");
        return;
      }

      const isVerified = await this.database.isVerified(telegramId);
      if (isVerified) {
        ctx.reply("You are already verified.");
        return;
      }

      // Generate a verification code
      const verificationCode = this.generateVerificationCode();

      // Save the verification code to the database
      try {
        await this.database.saveVerificationCode(telegramId, verificationCode);
      } catch (error) {
        console.error("Error saving verification code:", error);
        ctx.reply("An error occurred while generating the verification code.");
        return;
      }

      // Get the user's email address from the database
      const userEmail = await this.database.getUserEmail(telegramId);
      if (!userEmail) {
        ctx.reply("Email address not found for the user.");
        return;
      }

      // Send the verification email
      try {
        await this.verifier.sendVerificationEmail(userEmail, verificationCode);
        ctx.reply(
          "Verification email sent! Please check your email (and spam) and follow the instructions to complete the verification process."
        );
      } catch (error) {
        console.error("Error sending verification email:", error);
        ctx.reply("An error occurred while sending the verification email.");
      }
      //wait for reply
      //if reply is correct, then save to database
      //if reply is wrong, then ask them to try again
      //if reply is wrong 3 times, then ask them to try again later`
      // Wait for the user's reply with the verification code
      ctx.reply(
        "We've sent the verification code to your email address. Please run /verify {CODE} to verify your email address."
      );

      return;
    });

    // Command handler: book slot
    // this.bot.command("sheets", async (ctx) => {
    // const telegramId = ctx.from!.id.toString();
    // console.log(await this.updater.test());
    // });
  }

  private async checkAuthorization(telegramId: string): Promise<boolean> {
    // Perform authorization check based on your logic (e.g., database lookup)
    // Return true if authorized, false otherwise
    return this.database.isUser(telegramId);
  }

  private generateVerificationCode(): string {
    // Generate a random verification code
    return Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
  }
}

const configPath = "./config.yaml";
const configData = fs.readFileSync(configPath, "utf8");
const config = yaml.load(configData) as typeof Config;

//log config
console.log("botToken: ", config.botToken);
console.log("elasticEmailKey: ", config.elasticEmailKey);
console.log("supabaseUrl: ", config.supabaseUrl);
console.log("supabaseKey: ", config.supabaseKey);
console.log("googleServiceAccountEmail: ", config.googleServiceAccountEmail);
config.googleServiceAccountPrivateKey = config.googleServiceAccountPrivateKey
  .split(String.raw`\n`)
  .join("\n");
console.log(
  "googleServiceAccountPrivateKey: ",
  config.googleServiceAccountPrivateKey
);
const bot = new TelegramBot(
  config.botToken,
  config.elasticEmailKey,
  config.supabaseUrl,
  config.supabaseKey,
  config.googleServiceAccountEmail,
  config.googleServiceAccountPrivateKey,
  config.googleSpreadsheetId
);
