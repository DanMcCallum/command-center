# Combinatorial Ralph Loops and Proactive Fronts (recording), fronts section

Source: Skool post in The Trajectory Engineers by Roman Colman, posted about 2026-10-08,
https://www.skool.com/the-trajectory-engineers-2841/combinatorial-ralph-loops-and-proactive-fronts-recording?p=d0dd240a
Recording length 1:21:43. This file covers 50:50 to the end (the "proactive fronts" section).
Text source: the recording's own English CC track (Skool/Mux auto captions), pulled 2026-10-11.
A Whisper pass over the downloaded audio is in `transcript-fronts-section-whisper.md` for cross-checking.
Local copy of the video: ~/Downloads/skool-fronts/combinatorial-ralph-loops-and-proactive-fronts-720p.mp4 (not in the repo).

[00:50:50] on
[00:50:52] my proactive systems so currently this is kind of how my proactive systems work
[00:51:02] and I'll open up like one of these for example so each thing I do in my day to
[00:51:08] day has two markdown files we have a immutable file which is the north star
[00:51:15] which just focuses on like very quickly saying you know what is the north star
[00:51:20] what it is what don't looks like and pretty lean file and this makes it easy
[00:51:27] for me to just inject this file into Claude and then start work so if I go
[00:51:33] here and start a new Claude session and I just inject it with the at symbol
[00:51:46] I can immediately have a conversation about this thing and same thing with the
[00:51:53] now dot MD so I can inject both and then I can immediately say like what's
[00:52:00] next you know let's let's let's figure out what's next and these obviously what
[00:52:08] I would suggest is you set it up yourself according to how you would say
[00:52:13] it and then on the current now dot MD it basically updates using hooks so if I
[00:52:23] have kind of mentioned it before you have some hooks which identify every
[00:52:34] time your Claude session ends so if I have a Claude session I have a session
[00:52:40] end hook which will run after the session ends and it will then ask a haiku
[00:52:46] agent
[00:52:47] or Jev it will say which lane was this session in right and then the session
[00:53:00] will route to a lane where as you saw I have a bunch of different fronts in my
[00:53:05] work and anyone who says that they don't have like a couple of different
[00:53:09] things they do every day is just lying
[00:53:11] Everyone has like a specific capped amount of things
[00:53:15] that they do in their day to day.
[00:53:17] That can be broken into categories.
[00:53:19] So for me, like to give you inspiration,
[00:53:22] I have a done for you data engineering project
[00:53:24] for a large company.
[00:53:26] I'm building a software factory and applying for venture.
[00:53:29] I have my YouTube videos.
[00:53:31] I have an enterprise training strategy,
[00:53:35] pipeline for a client, potential partnership.
[00:53:38] So I have all these things
[00:53:39] and they all represent their own markdown file.
[00:53:42] And so we have these markdown files.
[00:53:46] We have the north star dot and D,
[00:53:49] which is like the ground truth.
[00:53:51] This is like never going to change for the most part.
[00:53:54] And the models aren't to change this
[00:53:58] because this is like what I have to say about the problem.
[00:54:00] You kind of hand write these.
[00:54:02] I'm going to go back, I've been changing the system today.
[00:54:05] So I'm going to go back and rehand write these.
[00:54:09] And then you have a movable, right?
[00:54:11] So each one has a,
[00:54:14] said North start ridiculous.
[00:54:16] And then you're going to have a movable.
[00:54:18] So this is the now dot and V.
[00:54:22] So this is dynamic, right?
[00:54:24] And so basically, we first have a,
[00:54:31] a cloud session ends and I have a hook for me,
[00:54:36] which summarize the session and put it in plot memory.
[00:54:41] And then I'm going to have which lane the session was in.
[00:54:47] And it's going to route,
[00:54:51] you guys saw the different fronts that I have in my work.
[00:54:54] So it chooses which one it was in, you know, typically it's one,
[00:54:58] but sometimes it can be two.
[00:55:00] And then based on this,
[00:55:02] it will then spawn another cloud dash P.
[00:55:06] And it will effectively say what,
[00:55:11] it will inject the session summary from down here
[00:55:16] based on what work I just did.
[00:55:20] It will inject to the northstar.md.
[00:55:23] It will inject the now dot and V.
[00:55:29] So it injects the previous session I just finished.
[00:55:33] It injects my ground truth and where we are now.
[00:55:36] And it basically says what's next for Roman
[00:55:41] and what could an autonomous agent be?
[00:55:46] So it asks those two questions.
[00:55:49] I don't remember if this is in two context windows,
[00:55:52] like a.k.a. this would be another cloud dash P
[00:55:56] with all the same info.
[00:55:57] I don't think it matters too much.
[00:55:59] But basically you have this.
[00:56:03] It will run this.
[00:56:04] And then you have another agent,
[00:56:07] which is given everything.
[00:56:09] And it of course says instead of this,
[00:56:14] it says updates now dot minimum.
[00:56:18] Right.
[00:56:21] So this allows persistent understanding
[00:56:24] of where we are in our fronts
[00:56:28] and also gives us nice suggestions
[00:56:31] on what we should do next.
[00:56:33] So you guys can see for me just to give you some examples.
[00:56:37] It also I have like yesterday.
[00:56:42] This is kind of cool because I have its own flow
[00:56:45] where I can see what I did yesterday, which is kind of fun.
[00:56:48] And then it suggests every day
[00:56:54] what the main thing I should do next is.
[00:56:58] But in general, I'll skip that one
[00:57:01] because I don't want to talk about that
[00:57:03] because there's an NDAs and stuff.
[00:57:05] But for my software factory,
[00:57:08] you know, get a clear start date for a small trial.
[00:57:13] What an autonomous agent could do
[00:57:16] is draft the application preview.
[00:57:18] So like, and then I can review the exact prompt
[00:57:22] and click accept.
[00:57:23] And it goes through my needs review and my command sound.
[00:57:27] So I'll just click accept for the fun of it.
[00:57:30] That reverse maps into my tasks.
[00:57:32] You can see there's pending and we're here.
[00:57:34] Right.
[00:57:37] Questions about this system thus far?
[00:57:40] - What's the hook for ending a session?
[00:57:47] Like it's not every prompt, right?
[00:57:49] But it's it's called a session end hook.
[00:57:54] I believe session end hooks trigger.
[00:57:59] I mean, I can look when you should look into when they trigger,
[00:58:03] but I believe it's 15 minutes AFK or no,
[00:58:08] I think it used to be 15 minutes AFK,
[00:58:10] but now it's just slash clear session
[00:58:13] or closed a session.
[00:58:16] And so when that happens, it will run the hook.
[00:58:21] Does that answer your question?
[00:58:26] - Yep.
[00:58:27] - Yeah. - Cool.
[00:58:28] - Yeah.
[00:58:29] So it's two session end hooks, right?
[00:58:33] So we have our cloud session.
[00:58:35] Cloud session ends one hook for this, one hook for this.
[00:58:39] And then these hooks, what runs these are right after.
[00:58:44] I think it's within this hook.
[00:58:48] So like, as you know, a hook is a bash script.
[00:58:50] So I'll just say batch.sh.
[00:58:55] And then it will spawn, it will be,
[00:58:59] say something like cloud.shp.
[00:59:01] What session was this in?
[00:59:03] And then it will take the output of this cloud.shp,
[00:59:09] I think just via schema checking.
[00:59:12] And then it will inject this cloud.shp.
[00:59:15] And then use the schema found previous
[00:59:24] as a dynamic injection and say this and this.
[00:59:29] So it's three cloud.shp's.
[00:59:33] It doesn't actually, like the reason I don't know this
[00:59:35] is 'cause like the details behind how this second hook
[00:59:39] is triggered doesn't really matter too much
[00:59:41] for internal systems.
[00:59:43] It just runs whenever this finishes.
[00:59:48] And how it does that, I don't really care.
[00:59:53] Cool.
[00:59:54] Okay, questions on.
[01:00:00] So I think one thing for you guys that would be cool
[01:00:04] is if we could actionably set something up like this
[01:00:08] for each of you.
[01:00:10] So maybe what I can do is on Friday's session,
[01:00:16] if you guys are here, I can do a little call on,
[01:00:23] like basically getting you guys the code
[01:00:25] for something like this
[01:00:27] and walking you through how to set this up in your own work.
[01:00:31] Yeah.
[01:00:34] - I would love this.
[01:00:36] Can I share my screen for a second?
[01:00:40] - Yeah, of course.
[01:00:41] - Funny thing is like it kind of follows
[01:00:46] some of the things that I can clear.
[01:00:51] This is kind of funny 'cause like it's kind of similar.
[01:01:22] With this North Star and kind of how I organize my work
[01:01:26] and I've been trying to figure out how to better automate
[01:01:28] a lot of this.
[01:01:29] One of it is like physical things
[01:01:33] that I have to do outside of clubs,
[01:01:35] but yeah, I think this would be super helpful
[01:01:37] for how I do a lot of business
[01:01:42] that I need to understand.
[01:01:44] I'm pretty bad at it.
[01:01:45] That in general, it's like prioritizing
[01:01:49] and like organizing my life.
[01:01:51] So I think this would be super helpful for me.
[01:01:54] - 100%.
[01:01:55] Yeah, I think for you,
[01:01:58] having maybe a little more granularity
[01:02:04] in the different things you do,
[01:02:06] like having more than just two fronts.
[01:02:08] Like for example, if you have one project at work
[01:02:12] versus your tickets at work
[01:02:15] and your tickets at work
[01:02:16] could be an autonomous system that is like,
[01:02:20] okay, we've detected a new ticket
[01:02:22] and now we're taking the plan or doing the ticket.
[01:02:27] And so like each one requires its own automations
[01:02:32] and I think that's what's cool about this.
[01:02:34] - Yeah, no, definitely.
[01:02:39] I have set that up on running the two tickets.
[01:02:43] I need to start comparing my normal work against it.
[01:02:47] But yeah, it's been,
[01:02:49] I haven't quite started actually committing those pages yet
[01:02:56] but yeah, you have to like kind of compare
[01:02:59] and like make sure that I'm comfortable with it at this point.
[01:03:03] - Cool.
[01:03:03] You could have another thing
[01:03:05] that basically part of the automation
[01:03:08] that looks over the trace of what the previous agent did
[01:03:12] and just very clearly outlines
[01:03:14] like every decision it made
[01:03:15] and why it did what it did
[01:03:17] so that your reviews aren't heinous.
[01:03:19] Let's see.
[01:03:25] There was one more thing that I forgot to mention
[01:03:28] that I've updated here.
[01:03:31] And basically in this architecture, the other thing,
[01:03:35] it does is it says,
[01:03:38] if it isn't obvious
[01:03:42] or there are blockers
[01:03:45] that Roman can answer,
[01:03:48] ask Roman.
[01:03:51] And I believe it also first says,
[01:03:56] spawn a subagent to research
[01:04:00] cloud accessible slash,
[01:04:05] cloud memory, which is my these session summaries.
[01:04:10] To get a feeling of the work we've done.
[01:04:19] So that's like another example.
[01:04:21] I think that's closer to what the prompt actually is.
[01:04:27] If it isn't obvious or there are blockers
[01:04:29] that Roman can answer, ask Roman instead
[01:04:32] of suggesting work.
[01:04:35] And the reason we do that is because a lot of times
[01:04:38] I realized that the work it was suggesting was like,
[01:04:41] it clearly had no idea where I actually was.
[01:04:44] And so it was just instead of asking me questions,
[01:04:47] it was asking me nonsense.
[01:04:49] So these open questions ideally would appear
[01:04:53] kind of in my needs review stuff like that.
[01:04:55] So you can actually see,
[01:04:57] oh, it's asking me a bunch of questions.
[01:05:01] So now my needs review, I'm gonna have to tune this,
[01:05:04] but it's like, oh, no, these aren't questions.
[01:05:07] These are actual tasks that I could say go ahead and do.
[01:05:12] So for example, I'm doing enterprise training.
[01:05:14] It would build this so I could approve
[01:05:20] and of course add notes, which is kind of cool.
[01:05:23] And then it'll run autonomously.
[01:05:25] For my videos, yeah, that'd actually be kind of cool.
[01:05:34] I'm gonna say approve.
[01:05:35] And then when you click approve, it goes through here.
[01:05:40] So once again, I'm kind of getting back
[01:05:42] to spending the majority of my time ideally
[01:05:44] in needs review and reading over these fronts
[01:05:49] and doing in the loop work for more thorough tasks.
[01:05:53] And then if it ever has questions for me,
[01:05:56] I just dictate the answer to those.
[01:05:58] Keep the system up to date
[01:05:59] so that it's suggesting good work consistently.
[01:06:04] So it's not only an organizational tool,
[01:06:06] but it's also a autonomous tool.
[01:06:09] And then as an extension of that,
[01:06:11] I have a nightly thing that runs that checks
[01:06:15] how much usage I have left and how long till reset.
[01:06:20] And if I have under 36 hours and over 60% usage left,
[01:06:25] it just does, it picks up these tasks automatically
[01:06:28] and just does them and to end in its own sandbox.
[01:06:32] You can see it does work trees.
[01:06:34] - How do you have it?
[01:06:37] How do you have a check usage?
[01:06:40] Because I had trouble getting my clog
[01:06:45] to check those percentages.
[01:06:48] - I'll ask for you to double check,
[01:06:51] but I believe it's in the status line.
[01:06:53] - Well, you can read the status line.
[01:07:00] - Yeah, the status line is where a lot of good data comes from
[01:07:05] and it can check from the status line, a lot of this data,
[01:07:09] but I'll just make sure that,
[01:07:11] 'cause I built this like a couple of weeks ago,
[01:07:14] so I could have forgotten what we actually decided on.
[01:07:18] But I remember it is accessible,
[01:07:23] like the data, where are we?
[01:07:25] - I was fighting my clog over it,
[01:07:27] like a couple of days ago. - You were fighting our clog?
[01:07:30] That's hilarious.
[01:07:31] - Oh, yeah, I've seen the same thing where, like,
[01:07:33] Claude will say, like, I don't have access to that.
[01:07:36] You have to go check the website.
[01:07:39] - I need like a administrator token.
[01:07:42] I was like, I gave you all access.
[01:07:44] (laughing)
[01:07:46] I don't know what you want.
[01:07:46] - No, it's status line, at least.
[01:07:50] Reading is only as fresh as the last time
[01:07:53] in the clog code session drew its status line,
[01:07:55] so, and in codecs, I think it was,
[01:07:59] I remember struggling with this, actually.
[01:08:01] Okay, yeah, so basically in codecs,
[01:08:09] there's just some sort of variable event,
[01:08:13] and in clog code, there is status line.
[01:08:17] - Great.
[01:08:19] - Thanks.
[01:08:20] - Yeah, you bet.
[01:08:23] And yeah, so if you want to take a screenshot,
[01:08:26] you could probably just inject this.
[01:08:28] But yeah, I mean, it's kind of a cool idea
[01:08:35] because it's fully a self-licking ice cream cone,
[01:08:38] which means, like, all I have to do is just do my normal work,
[01:08:42] and sometimes answer some questions,
[01:08:45] and not only do I get kind of really tailored,
[01:08:48] nice suggestions, which, by the way, FYI,
[01:08:52] you're never gonna get a one-size-fits-all system
[01:08:54] that can do this.
[01:08:56] Like, that's literally impossible.
[01:08:58] You have to have a system that you built yourself
[01:09:01] that's tailored to your needs and what good looks like.
[01:09:04] It's never gonna just kind of spawn that in for you.
[01:09:08] And then, of course, like, instead of me running out of usage,
[01:09:14] it just does the work for me, in those cases,
[01:09:18] where it identifies that.
[01:09:20] So, I'll get you guys the templates to this,
[01:09:24] or at least the specs to this in the command center,
[01:09:28] just as a little gift, once I have this finished.
[01:09:33] And once I've used it for a couple of days,
[01:09:35] 'cause I think it's important that it actually becomes,
[01:09:39] or is something that I use consistently for a long time,
[01:09:43] like I did the command center and like I do the command center
[01:09:46] for then me to give it to you.
[01:09:48] But if you wanna build this on your own now,
[01:09:51] just take this lecture and you can probably give the lecture
[01:09:53] to Claude and he'll understand.
[01:09:56] Questions, thoughts, anything else you wanna see?
[01:10:04] - How do I give a lecture to Claude, like this?
[01:10:08] And I can link to, you send the links to the videos,
[01:10:13] but I don't know how to pass that to Claude.
[01:10:17] But pro tip, all you gotta do is go,
[01:10:20] let me show you here, you're gonna click,
[01:10:24] let's say, this recording, after this, boom,
[01:10:29] open up Claude, you're gonna say, extract this video
[01:10:36] as MP4 on my computer and use, you know,
[01:10:42] for you, you might have an external dictation tool,
[01:10:45] or transcription tool, or your own,
[01:10:47] for me, I have slash dictation tool to grab the transcript.
[01:10:52] And it works like that.
[01:10:57] It's almost like magic nowadays.
[01:10:59] I remember this didn't used to work,
[01:11:00] but it works extremely well now.
[01:11:02] So yeah, just give it this,
[01:11:07] tell it to use browser, control, and it'll work.
[01:11:13] So it pretty much can do that for any instance.
[01:11:16] - Pretty much, yeah, any video whatsoever.
[01:11:21] Claude has figured out a way to find it
[01:11:25] in the exposed user interface stuff,
[01:11:29] because it just goes through your browser.
[01:11:31] And another pro tip is that Claude in Chrome
[01:11:34] is logged into your browser.
[01:11:36] So sometimes if you use an unlocked in playwright,
[01:11:39] this wouldn't work.
[01:11:40] But Claude in Chrome is the same as a user,
[01:11:42] so it is exposed the same stuff a user can see.
[01:11:45] Which also means you can do automations
[01:11:51] that won't get you banned.
[01:11:53] Like my LinkedIn automation,
[01:11:55] I run 24/7.
[01:11:58] Right.
[01:12:00] So you can see it's always posting various posts.
[01:12:11] - I'm actually reading those.
[01:12:13] - I'm actually reading those and some of them are really good.
[01:12:17] - Yeah, they're good, right?
[01:12:19] - Yeah. (laughs)
[01:12:20] - It's funny.
[01:12:22] - Yeah, I mean, if you have a good enough pipeline,
[01:12:24] like there are some that I delete manually
[01:12:27] 'cause I see them and I'm like,
[01:12:28] holy this missed the mark.
[01:12:30] But in general, like maybe I'll show them again.
[01:12:34] It's, 'cause it takes, the thing is like,
[01:12:38] if it takes real inspiration, then it has real work
[01:12:41] it can look from.
[01:12:42] So I was reading this one today.
[01:12:44] I have Claude, I might build in like a better hook system
[01:12:48] to like actually give more entertaining hooks,
[01:12:51] but I've got code build five interfaces, ideas at once,
[01:12:54] then I pick the one I wanna keep.
[01:12:56] Launch subagents, they build the alternatives.
[01:13:00] I use this for interfaces and animations.
[01:13:03] I believe it grabbed this from one of our cohort calls.
[01:13:08] So just grab the way I talk about a topic.
[01:13:10] It has a system to recreate my voice
[01:13:12] and then it has a, obviously like a skill
[01:13:15] or a pipeline to build the visuals and obviously templates.
[01:13:20] But is there anything else?
[01:13:29] Any other questions on this or any other thoughts
[01:13:32] on kind of how to get an autonomous system like this
[01:13:35] that's proactive?
[01:13:39] It all makes sense.
[01:13:41] I still have some gaps.
[01:13:43] The biggest gap I have is like conceptually I get
[01:13:47] going into command center and setting up pipelines,
[01:13:50] running them, et cetera.
[01:13:51] I'm starting to play with creating like extensions
[01:13:54] of the dashboard, but I'm getting kind of hung up
[01:13:58] when you wanna do more advanced things.
[01:14:01] Like I think you've called it like a mini SAS kind of thing.
[01:14:05] - I like your sauce, yeah.
[01:14:07] - Yeah, micro SAS.
[01:14:08] Yeah, yeah, I'm still just trying to figure out conceptually
[01:14:16] like when I have an idea how I spend my time
[01:14:21] between the CLI and command center,
[01:14:24] getting everything kind of orchestrated
[01:14:26] to where then it's in the right repo
[01:14:31] and I get that like you, I think you run more
[01:14:33] like a mono repo thing and maybe I need to go to that
[01:14:37] because I think part of my challenge is I've got
[01:14:39] too many repos and I'm not going on tangents, sorry.
[01:14:44] Yes, I've got fronts that I'm thinking about now.
[01:14:49] I haven't implemented yet and so I'm excited for Friday.
[01:14:54] You know, maybe I'll leave it there.
[01:14:56] I just need to see more examples of like
[01:14:59] and things will click I think.
[01:15:02] - Yes, so in general, like for this stuff,
[01:15:06] like for example, how I built this market research pipeline
[01:15:11] is I basically said, I went, I'll scare this,
[01:15:16] I went into the command center and of course
[01:15:18] I have spec maps for it.
[01:15:20] So I just say, boom, here's the read me.
[01:15:23] And I say, I would like to build a new feature
[01:15:28] in the command center called market research period.
[01:15:33] It should have its own page on the dashboard.
[01:15:40] Here's the flow I want.
[01:15:45] We have a cron job installed at 6 a.m.
[01:15:52] that strikes the most viral videos
[01:15:57] according to the dot.
[01:16:00] And then I'd like to give it inspiration.
[01:16:03] So I can say, look at my cron tab
[01:16:06] for how I have to set up.
[01:16:09] This is very important 'cause I've seen this happen
[01:16:13] before where there are issues and you just root that out.
[01:16:16] Then you say something like blah, blah, blah, blah, blah.
[01:16:19] And then I'll say implemented via a dynamic workflow.
[01:16:25] And then I will see what it puts out and I will tune it.
[01:16:30] - Got it.
[01:16:31] That was helpful, thank you.
[01:16:32] - Very simple.
[01:16:33] Yeah, for internal tools, like obviously for external tools
[01:16:36] it's different, which is why I have all the things I teach.
[01:16:39] But for internal tools like that specifically,
[01:16:42] it's really as simple as move as fast as possible
[01:16:46] and like be very descriptive of the high level idea
[01:16:50] you want and make sure that cloud is not
[01:16:54] bloating the idea.
[01:16:56] Like for example, if I wanted to make a cloud skill
[01:17:00] that I use, I would very clearly ask for the skill
[01:17:04] and then I would very clearly make sure
[01:17:06] that it builds the skill in a way that's not adding
[01:17:09] a bunch of other instructions.
[01:17:11] - Yeah.
[01:17:13] - And that's nowadays the main thing to navigate
[01:17:16] is like over engineering 'cause it does that.
[01:17:21] But yeah, I mean, I can look at any of these.
[01:17:25] And for me, this is all I needed.
[01:17:27] And sometimes there are little issues.
[01:17:31] I think maybe they removed my Reddit access.
[01:17:36] Or maybe not, odd to look.
[01:17:38] I'm also considering like a global slash goal agent
[01:17:44] that's running 24/7 or a global route loop
[01:17:49] with a slash goal.
[01:17:50] That's just looking for little issues like this
[01:17:53] in my command center and patching them minimally.
[01:17:56] Like I think you could do that and it wouldn't be hard.
[01:18:00] So it would just grep or rejects the word failed.
[01:18:07] And then it would expand around that.
[01:18:09] And then it would be, oh look, Reddit pipeline failed.
[01:18:12] Here's why.
[01:18:12] And then it would put in my needs review
[01:18:14] like an overview of why that happened.
[01:18:20] No reason you couldn't.
[01:18:21] Let's see what this came up with.
[01:18:24] Yeah, that's what this built.
[01:18:31] Okay, so I think I am going to jump off
[01:18:39] so that I can have more time to prepare
[01:18:45] for Friday's lecture where I will have something
[01:18:50] like this for each one of you, your homework,
[01:18:53] each one of you, hopefully you can make it
[01:18:55] to the call on Friday, otherwise DM me.
[01:18:57] But your homework is to build these files.
[01:19:02] And so just to make it very, very clear what you need to do
[01:19:06] and you can give this transcript to cloud once again,
[01:19:09] is open up two files.
[01:19:13] The first, you're going to write manually,
[01:19:16] which is basically your north star of what the thing
[01:19:19] actually is, right?
[01:19:21] What it is, kind of the north star behind what you want.
[01:19:25] If you have any examples of what good looks like
[01:19:28] on your computer, so oops, I clicked the wrong thing.
[01:19:31] So for my videos, I have like three reference decks
[01:19:35] that I really like, right?
[01:19:38] And these three reference decks serve
[01:19:41] as few shot inspiration.
[01:19:42] And you can see how this is different
[01:19:44] from maybe like my business strategy front
[01:19:47] or something else.
[01:19:48] So then you're going to have it also create,
[01:19:53] or you guys won't have it create this yet.
[01:19:58] I'll have it do an automation in your systems
[01:20:01] to create that.
[01:20:02] Yeah, and the other thing is just identifying
[01:20:08] like what possible tasks it could do
[01:20:12] sometimes can be valuable.
[01:20:14] And because, for example,
[01:20:17] my pipeline for a production level application
[01:20:22] like this software engineer pipeline,
[01:20:25] what work it does will be different from my videos, right?
[01:20:30] My videos, I have a once a week video I would like.
[01:20:34] And so that's very different from,
[01:20:37] you know, what's next in my code base.
[01:20:39] Or again, as an example for Daniel,
[01:20:42] Daniel's full time job part of it
[01:20:44] is taking tickets and doing the tickets.
[01:20:46] So building his own autonomous system to do those tickets
[01:20:49] instead of just reusing this template
[01:20:52] may be better for that.
[01:20:55] And then he just gets an alert
[01:20:57] if the ticket is wrong,
[01:20:59] or like if something went wrong in the ticket.
[01:21:04] So yeah, actionable step, make,
[01:21:08] split down your day-to-day,
[01:21:10] everything you do in your day-to-day
[01:21:12] that you want tracked into these pipelines.
[01:21:16] And then write these manually.
[01:21:19] And then come to the call Friday.
[01:21:23] Cool, any closing questions?
[01:21:35] - No, thank you so much.
[01:21:37] - All right, guys.
[01:21:38] - Take care.
[01:21:39] - Thank you everyone.
[01:21:40] Have a good rest of your day.
[01:21:42] - Thanks for having us.
[01:21:43] - Bye.
