import { Ballot, Slot } from "../database";
import { addDays, stripTime, weekStart } from "../timeutils";
import Plotly from "plotly.js";

class Unit {
  start: Date;
  end: Date;
  public constructor(tzstart: string, tzend: string) {
    this.start = new Date(tzstart);
    this.end = new Date(tzend);
  }
}

/**
 * A class that generates a visualisation of ballots or slots
 */
export class DVisualiser {
  /**
   * Given an allocation of ballots, generate a heatmap
   */
  static async showBallots(ballots: Ballot[]): Promise<string> {
    const slots = ballots
      .map((ballot) => new Unit(ballot.time_begin, ballot.time_end))
      .sort((a, b) => (a.start < b.start ? -1 : a.start === a.end ? 0 : 1));
    const acc: Unit[][] = [];
    for (let x = 0; x < slots.length; x++) {
      const unit = slots[x];
      const unitbegin = stripTime(unit.start);
      if (acc.length < 1 || acc[acc.length - 1][0].start !== unitbegin) {
        acc[acc.length] = [unit];
      } else {
        acc[acc.length - 1].push(unit);
      }
    }
    acc.map((day) => {
      const hours = new Array(24).map((_) => 0);
      day.forEach((unit) => {
        const start = unit.start.getHours();
        const end = unit.end.getHours();
        for (let i = start; i <= end; i++) {
          hours[i]++;
        }
      });
      return hours;
    });
    const data: any[] = [
      {
        z: acc,
        y: [...Array(acc.length).keys()].map((offset) =>
          addDays(weekStart(), offset).toDateString()
        ),
        x: [...Array(24).keys()].map((hour) => `${hour}:00`),
      },
    ];
    await Plotly.newPlot("mydiv", data);
    return Plotly.toImage("chart", {
      format: "png",
      width: 800,
      height: 600,
    }).then(function (dataURI: string) {
      return dataURI;
    });
  }
  
  static showSlots() {
    return;
  }
}
