import { Telegraf, Context, Scenes, Composer, session, Markup } from "telegraf";
import { EmailVerifier } from "../email/email";
import { DDatabase } from "../database/d-database";
import { DVisualiser } from "../dvisualiser/dvisualiser";
import { WizardContext, WizardScene } from "telegraf/typings/scenes";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { LiveUpdater } from "../live_updater/live_updater";
import { CronJob } from "cron";
import { DManager } from "../dmanager";
import { addDays, weekStart } from "../timeutils";

interface Config {
  botToken: string;
  elasticEmailKey: string;
  supabaseUrl: string;
  supabaseKey: string;
}

interface MyWizardSession extends Scenes.WizardSessionData {
  // will be available under `ctx.scene.session.myWizardSessionProp`
  name: string;
  email: string;
  room_no: string;
}
type MyContext = Scenes.WizardContext<MyWizardSession>;
//https://github.com/feathers-studio/telegraf-docs/blob/master/examples/wizards/wizard-with-custom-scene-session.ts
//const nameStepHandler = new Composer<Scenes.WizardContext>();
class TelegramBot {
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
          this.manager.resolve();
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
          this.updater.updateSheets();
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
        /ballot - Ballot for a slot
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

    this.bot.command("view_ballots", async (ctx) => {
      const ballotsStart = addDays(weekStart(), 7);
      const ballotsEnd = addDays(ballotsStart, 6);
      const ballots = await this.database.getBallotsByTime(
        ballotsStart,
        ballotsEnd
      );
      const imageReply = await DVisualiser.showBallots(ballots);
      ctx.replyWithPhoto(imageReply);
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
      } catch (error) {
        console.error("Error marking user as verified:", error);
        ctx.reply("An error occurred while marking the user as verified.");
      }
    });
    // Command handler: Unregister and delete user data
    this.bot.command("unregister", async (ctx) => {
      const telegramId = ctx.from!.id.toString();

      try {
        await this.database.delUser(telegramId);
        ctx.reply("You have been unregistered and your data has been deleted.");
      } catch (error) {
        console.error("Error unregistering user:", error);
        ctx.reply("An error occurred while unregistering.");
      }
    });
    // Command handler: ballot slot
    this.bot.command("ballot", async (ctx) => {
      const telegramId = ctx.from!.id.toString();
      //check if registered
      const isRegistered = await this.database.isRegistered(telegramId);
      if (!isRegistered) {
        ctx.reply("You are not registered. Please run /register to register.");
        return;
      }
      //check if verified
      const isVerified = await this.database.isVerified(telegramId);
      if (!isVerified) {
        ctx.reply(
          "You are not verified. Please run /get_code to get a verification code sent to your email address."
        );
        return;
      }
      const dates = generateDates(config.n);
      const buttons = dates.map((date) => {
        const [year, month, day] = date.split("-");
        const formattedDate = new Date(date).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        return [Markup.button.callback(formattedDate, `DATE ${date}`)];
      });
      ctx.reply("Select a date:", Markup.inlineKeyboard(buttons));
    });
    const config = {
      n: 7, //Number of days available for booking
      timeInterval: 20, // Subdivisions of time in minutes
      startingTime: "08:00", // Starting time
      endingTime: "21:00", // Ending time
      maxLength: 120, // Max length of a booking in minutes
      rows: 50,
      columns: 6,
    };

    // Helper function to generate a range of time slots
    const generateTimeSlots = (start: Date, end: Date, interval: number) => {
      const slots = Array<string>();
      const current = start;

      while (current < end) {
        const hours = String(current.getHours()).padStart(2, "0");
        const minutes = String(current.getMinutes()).padStart(2, "0");
        slots.push(`${hours}:${minutes}`);
        current.setMinutes(current.getMinutes() + interval);
      }

      return slots;
    };

    // Helper function to generate the dates for the next n days
    const generateDates = (n: number) => {
      //
      const start_date = new Date().getDate() + 7;
      const dates = Array<string>();
      for (let i = 0; i < n; i++) {
        const date = new Date();
        date.setDate(start_date + i);
        dates.push(date.toISOString().slice(0, 10));
      }
      return dates;
    };

    // Command '/book'

    this.bot.action(/^DATE (.+)/, (ctx) => {
      const date = ctx.match![1];

      const startTime = new Date(`2023-01-01T${config.startingTime}:00`);
      const endTime = new Date(`2023-01-01T${config.endingTime}:00`);

      const slots = generateTimeSlots(startTime, endTime, config.timeInterval);
      /*
      const buttons = slots.map((slot) =>
        Markup.button.callback(slot, `START_TIME ${date} ${slot}`)
      );
      */
      const buttons = [];
      for (let i = 0; i < config.rows; i++) {
        const row = [];
        for (let j = 0; j < config.columns; j++) {
          const index = i * config.columns + j;
          if (index < slots.length) {
            const slot = slots[index];
            row.push(
              Markup.button.callback(slot, `START_TIME ${date} ${slot}`)
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

    this.bot.action(/^START_TIME (.+) (.+)/, (ctx) => {
      const date = ctx.match![1];
      const startTime = ctx.match![2];

      const start = new Date(`2023-01-01T${startTime}:00`);
      start.setMinutes(start.getMinutes() + config.timeInterval);
      const end = new Date(`2023-01-01T${startTime}:00`);
      end.setMinutes(end.getMinutes() + config.maxLength);

      const slots = generateTimeSlots(start, end, config.timeInterval);
      const buttons = slots.map((slot) =>
        Markup.button.callback(slot, `END_TIME ${date} ${startTime} ${slot}`)
      );

      ctx.editMessageText(
        `You selected ${startTime} as starting time. Select an ending time:`,
        Markup.inlineKeyboard(buttons)
      );
    });

    this.bot.action(/^END_TIME (.+) (.+) (.+)/, async (ctx) => {
      const date = ctx.match![1];
      const startTime = ctx.match![2];
      const endTime = ctx.match![3];

      ctx.editMessageText(
        `You selected ${endTime} as ending time. Your ballot is from ${startTime} to ${endTime} on ${date}.`
      );
      //add to database
      const start = new Date(`${date}T${startTime}:00`);
      const end = new Date(`${date}T${endTime}:00`);
      try {
        // await this.database.addBallot(ctx.from!.id.toString(), start, end);
        // log the dates
        console.log("start: ", start);
        console.log("end: ", end);
        //TODO: use the ballot function
        await this.manager.ballot(ctx.from!.id.toString(), start, end);
        ctx.reply("Ballot added to database.");
      } catch (error) {
        console.error("Error adding ballot to database:", error);
        ctx.reply("An error occurred while adding ballot to database.");
        ctx.reply("Error is " + error);
        return;
      }
    });

    // Command handler: book slot
    this.bot.command("book", async (ctx) => {
      const telegramId = ctx.from!.id.toString();
      //check if registered
      const isRegistered = await this.database.isRegistered(telegramId);
      if (!isRegistered) {
        ctx.reply("You are not registered. Please run /register to register.");
        return;
      }
      //check if verified
      const isVerified = await this.database.isVerified(telegramId);
      if (!isVerified) {
        ctx.reply(
          "You are not verified. Please run /get_code to get a verification code sent to your email address."
        );
        return;
      }
      const dates = generateDatesForBook(config.n);
      const buttons = dates.map((date) => {
        const [year, month, day] = date.split("-");
        const formattedDate = new Date(date).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        return [Markup.button.callback(formattedDate, `DATE_BOOK ${date}`)];
      });
      ctx.reply("Select a date:", Markup.inlineKeyboard(buttons));
    });

    // Helper function to generate the dates for the next n days
    const generateDatesForBook = (n: number) => {
      const start_date = new Date().getDate(); // start from the current day
      const dates = Array<string>();
      for (let i = 0; i < n; i++) {
        const date = new Date();
        date.setDate(start_date + i);
        dates.push(date.toISOString().slice(0, 10));
      }
      return dates;
    };

    this.bot.action(/^DATE_BOOK (.+)/, (ctx) => {
      // Remaining code as is, but change `START_TIME` to `START_TIME_BOOK`
      const date = ctx.match![1];

      const startTime = new Date(`2023-01-01T${config.startingTime}:00`);
      const endTime = new Date(`2023-01-01T${config.endingTime}:00`);

      const slots = generateTimeSlots(startTime, endTime, config.timeInterval);
      /*
      const buttons = slots.map((slot) =>
        Markup.button.callback(slot, `START_TIME ${date} ${slot}`)
      );
      */
      const buttons = [];
      for (let i = 0; i < config.rows; i++) {
        const row = [];
        for (let j = 0; j < config.columns; j++) {
          const index = i * config.columns + j;
          if (index < slots.length) {
            const slot = slots[index];
            row.push(
              Markup.button.callback(slot, `START_TIME_BOOK ${date} ${slot}`)
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

    this.bot.action(/^START_TIME_BOOK (.+) (.+)/, (ctx) => {
      // Remaining code as is, but change `END_TIME` to `END_TIME_BOOK`
      const date = ctx.match![1];
      const startTime = ctx.match![2];

      const start = new Date(`2023-01-01T${startTime}:00`);
      start.setMinutes(start.getMinutes() + config.timeInterval);
      const end = new Date(`2023-01-01T${startTime}:00`);
      end.setMinutes(end.getMinutes() + config.maxLength);

      const slots = generateTimeSlots(start, end, config.timeInterval);
      const buttons = slots.map((slot) =>
        Markup.button.callback(
          slot,
          `END_TIME_BOOK ${date} ${startTime} ${slot}`
        )
      );

      ctx.editMessageText(
        `You selected ${startTime} as starting time. Select an ending time:`,
        Markup.inlineKeyboard(buttons)
      );
    });

    this.bot.action(/^END_TIME_BOOK (.+) (.+) (.+)/, async (ctx) => {
      // Remaining code as is
      const date = ctx.match![1];
      const startTime = ctx.match![2];
      const endTime = ctx.match![3];

      ctx.editMessageText(
        `You selected ${endTime} as ending time. Your booking is from ${startTime} to ${endTime} on ${date}.`
      );
      //add to database
      const start = new Date(`${date}T${startTime}:00`);
      const end = new Date(`${date}T${endTime}:00`);
      try {
        console.log("start: ", start);
        console.log("end: ", end);
        await this.manager.book({
          userTelegramId: ctx.from!.id.toString(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
        ctx.reply("Booking added to database.");
      } catch (error) {
        console.error("Error adding booking to database:", error);
        ctx.reply("An error occurred while adding booking to database.");
        ctx.reply("Error is " + error);
        return;
      }
    });

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

interface Config {
  botToken: string;
  elasticEmailKey: string;
  supabaseUrl: string;
  supabaseKey: string;
  googleServiceAccountEmail: string;
  googleServiceAccountPrivateKey: string;
  googleSpreadsheetId: string;
}

const configPath = "./config.yaml";
const configData = fs.readFileSync(configPath, "utf8");
const config: Config = yaml.load(configData) as Config;

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
