# Combinatorial Ralph Loops and Proactive Fronts (recording), fronts section, Whisper pass

Same recording as transcript-fronts-section.md (50:45 to 1:21:43). Generated 2026-10-11 from the
downloaded audio track with faster-whisper (model small, int8, CPU, VAD on). Use alongside the caption
version: Whisper tends to get sentence boundaries right where the captions chop lines, and the captions
occasionally catch a word Whisper drops.

[00:50:45] It's been an hour. I think okay. I'll real quick just lecture on an update on
[00:50:53] My proactive systems
[00:50:56] So currently this is kind of how my proactive systems work
[00:51:01] and
[00:51:03] I'll open up
[00:51:04] Like one of these for example
[00:51:06] So each thing I do in my day-to-day has two markdown files
[00:51:11] We have a immutable file, which is the north star which just focuses on like very quickly saying
[00:51:18] You know, what is the north star? What it is?
[00:51:22] What done looks like and pretty lean file and this makes it easy for me to just inject this file
[00:51:30] Into Claude and then start work. So if I go here and start a new
[00:51:36] Claude session and
[00:51:38] I just inject it
[00:51:41] With the at symbol
[00:51:44] I
[00:51:46] Can immediately have a conversation about this thing
[00:51:52] And same thing with the now dot md. So I can inject both
[00:51:58] And then I can immediately say like what's next, you know, let's let's let's figure out what's next and
[00:52:04] these obviously
[00:52:07] What I would suggest is you set it up yourself
[00:52:11] according to how you would say it and
[00:52:14] then on the current now dot md it basically
[00:52:21] Updates using hooks. So if I've kind of mentioned it before
[00:52:28] You have some hooks
[00:52:31] Which identify every time your Claude session ends
[00:52:37] So if I have a Claude session
[00:52:39] I have a session and hook which will run after the session ends and it will then ask a
[00:52:46] Haiku agent or Jeff
[00:52:50] It will say which lane was this session in
[00:52:56] Right and then the session
[00:53:00] Will route to a lane where as you saw I have a bunch of different fronts in my work and
[00:53:06] Anyone who says that they don't have like a couple of different things they do every day is just lying
[00:53:11] Everyone has like a specific
[00:53:14] Cap amount of things that they do in their day-to-day that can be broken into categories
[00:53:19] So for me like to give you inspiration
[00:53:21] I have a done-for-you-date engineering project for a large company. I'm building a software factory and applying for venture
[00:53:29] I have my YouTube videos. I have an enterprise training
[00:53:33] Strategy pipeline for a client
[00:53:36] Potential partnership, so I have all these things and they all represent their own markdown file
[00:53:43] And so we have these markdown files. We have the north star dot md
[00:53:49] Which is like the ground truth. This is like never gonna change for the most part
[00:53:55] And the models aren't to change this because this is like what I have to say about the problem
[00:54:00] You kind of hand write these I'm gonna go back. I've been changing the system today
[00:54:05] So I'm gonna go back and re hand write these and
[00:54:08] Then you have a moveable right so each one has a
[00:54:13] said nor start
[00:54:15] And then you're gonna have a moveable
[00:54:20] So this is the now dot md, so this is dynamic right and so basically we first have a
[00:54:33] Claude session ends and I have a hook for me which
[00:54:37] summarized
[00:54:38] the session and
[00:54:40] put it in thought memory and
[00:54:44] Then I'm gonna have which lane the session was in
[00:54:48] And it's gonna route, you know, you guys saw the different fronts that I have in my work
[00:54:54] So it chooses which one it was in
[00:54:56] You know typically it's one but sometimes it can be two and then based on this
[00:55:02] It will then spawn another Claude dash p
[00:55:05] and
[00:55:06] It will effectively say
[00:55:10] What it will inject the session summary
[00:55:15] From down here
[00:55:17] Based on what work I just did it will inject to the nor star dot md
[00:55:26] It will inject the now dot md
[00:55:29] So it injects the previous session I just finished it injects my ground truth and where we are now and it basically says what's next
[00:55:39] for Roman and what could an autonomous
[00:55:45] Agents
[00:55:47] So that's those two questions. I don't remember if this is in two context windows like aka
[00:55:53] This would be another Claude dash p with all the same info
[00:55:57] I don't think it matters too much
[00:56:00] But basically you have this it will run this and then you have another agent
[00:56:07] Which is given everything and it of course
[00:56:12] Says instead of this it says updates now dot md
[00:56:18] Minimum right
[00:56:21] So this allows persistent understanding of where we are in our fronts and
[00:56:28] Also gives us nice suggestions on
[00:56:32] What we should do next so you guys can see for me just to give you some examples it also um, I have
[00:56:41] Like yesterday, this is kind of cool because I have its own flow where I can see what I did yesterday, which is kind of fun
[00:56:52] And then it suggests every day what the main thing I
[00:56:56] Should do next is but in general
[00:57:00] I'll skip that one because I don't want to talk about that because there's some NDAs and stuff, but for my software factory
[00:57:09] You know get a clear start date for a small trial
[00:57:14] What an autonomous agent could do is draft an application preview
[00:57:19] So like and then I can review the exact prompt and click accept
[00:57:23] And it goes through my needs review in my command so
[00:57:26] So I'll just click except for the fun of it
[00:57:29] That reverse maps into my tasks so you can see there's pending and we're here
[00:57:36] right
[00:57:38] Questions about this system thus far
[00:57:43] What's the hook for ending a session like how like it's not every prompt right that it's doing it
[00:57:51] It's called a session end hook I
[00:57:54] Believe session end hooks trigger I
[00:57:59] Mean I can look one or you should look into when they trigger, but I believe it's 15 minutes
[00:58:06] AFK or no, I think it used to be 15 minutes AFK, but now it's just slash clear session
[00:58:13] or
[00:58:14] closed a session and
[00:58:17] So when that happens it will run the hook
[00:58:21] Does it does that answer your question?
[00:58:26] Yep. Yeah, cool. Yeah, so it's a
[00:58:31] Two session and hooks right so we have our cloud session
[00:58:34] Cloud session ends one hook for this
[00:58:38] One hook for this and then these hooks what runs these are
[00:58:44] Right after I think it's within this hook
[00:58:47] So like as you know a hook is a bash script so I'll just just say batch dot sh
[00:58:53] and
[00:58:54] Then it will spawn
[00:58:57] It will be something like cloud fp. What session was this in?
[00:59:05] And then it will take the output of this cloud dash p I think just via
[00:59:11] Schema checking and then it will inject this cloud fp
[00:59:18] And then use the schema
[00:59:21] found previous
[00:59:23] as a dynamic injection and say
[00:59:27] This and this
[00:59:30] So it's three cloud dash p's
[00:59:33] It doesn't actually like the reason I don't know this is because like the details behind how this second hook is triggered
[00:59:39] Doesn't really matter too much for internal systems
[00:59:43] It just runs
[00:59:47] Whenever this finishes and how it does that I don't really care cool
[00:59:57] Okay questions on
[00:59:59] So so I think one thing for you guys
[01:00:03] That would be cool is if we could actionably, you know set something up like this for each of you
[01:00:11] So maybe what I can do is on Friday's session if you guys are here I
[01:00:18] can do a little call on
[01:00:23] Sit like basically getting you guys the code for something like this and
[01:00:27] Teat walking you through how to set this up in your own work
[01:00:33] Yeah, I would love this
[01:00:37] Can I share my screen for second? Yeah, of course
[01:00:43] Funny things like it kind of falls
[01:00:46] The
[01:00:52] So this is kind of funny because like it's kind of similar with this north star and kind of how I
[01:01:24] Organize my work and I've been trying to figure out how to better automate a lot of this
[01:01:30] One of it is like physical things that I have to do outside of club, but yeah, I think this would be super helpful for
[01:01:39] How I do
[01:01:42] I'm pretty bad
[01:01:46] Bad at in general like prioritizing and like organizing my life. So I think this would be super helpful for me
[01:01:54] Yeah, I think I think for you
[01:01:59] You know having
[01:02:02] Maybe a little more granularity in the different things you do like having more than just two fronts
[01:02:09] Like for example if you have one project at work versus your tickets at work and your tickets at work could be
[01:02:17] You know an autonomous system that is like, okay
[01:02:20] We've detected a new tickets and now we're taking the plan or doing the ticket
[01:02:26] And so like each one requires its own automations
[01:02:31] And I think that's what's cool about this
[01:02:37] Yeah
[01:02:39] And I have set that up
[01:02:41] Running the dirt tickets. I need to start comparing my normal work against it, but
[01:02:48] Yeah, it's been a
[01:02:51] I haven't quite start started actually committing those pages yet
[01:02:56] But yeah, it's like kind of compare and like make sure that I'm comfortable with it at this point
[01:03:02] Cool, you could have another thing that basically
[01:03:06] Part of the automation that looks over the trace of what the previous agent did and just very clearly
[01:03:13] Outlines like every decision it made and and why I did what it did so that your reviews aren't heinous
[01:03:24] Let's see what there was one more thing that I forgot to mention that I've updated here and
[01:03:30] And basically in this architecture the other thing it does is it says
[01:03:38] If it isn't
[01:03:41] Obvious or there are blockers
[01:03:46] That Roman can answer
[01:03:50] Ask around and
[01:03:52] I believe it also
[01:03:54] first says
[01:03:57] spawn a sub agent
[01:03:59] to research
[01:04:03] Clot accessible slash
[01:04:05] Lot memory, which is my
[01:04:08] these session summaries
[01:04:11] To get a feeling of
[01:04:17] The work we've done. So that's like another example
[01:04:22] I think that's closer to what the prompt actually is
[01:04:26] If it isn't obvious or there are blockers that Roman can answer ask Roman instead
[01:04:33] of
[01:04:34] Suggesting work
[01:04:35] And the reason we do that is because a lot of times I realized that the work it was suggesting was like it clearly had no
[01:04:42] Idea where I actually was
[01:04:44] And so it was just instead of asking me questions. It was asking me nonsense
[01:04:48] So these open questions
[01:04:51] Ideally would appear kind of in my needs review
[01:04:54] Stuff like that so you can actually see
[01:04:58] Oh, it's asking me a bunch of questions
[01:05:01] So now my needs review I'm gonna have to tune this but it's like
[01:05:05] Oh, no, these aren't questions
[01:05:07] These are actual tasks that I could say go ahead and do
[01:05:11] So for example, I'm doing enterprise training
[01:05:16] It would build this
[01:05:19] So I could approve and of course add notes, which is kind of cool and then it'll run autonomously
[01:05:27] for my videos
[01:05:29] Yeah
[01:05:32] That actually be kind of cool
[01:05:34] I'm gonna say approve
[01:05:36] And then when you click approve it goes through here
[01:05:39] So once again, I'm kind of getting back to spending the majority of my time ideally and needs review and
[01:05:47] Reading over these fronts and doing in the loop work for more thorough tasks
[01:05:53] And then if it ever has questions for me, I just dictate the answer to those
[01:05:58] Keep the system up to date so that it's suggesting good work consistent
[01:06:03] So it's not only an organizational tool, but it's also a
[01:06:08] Autonomous tool and then as an extension of that I have a nightly thing that runs
[01:06:14] That checks how much usage I have left
[01:06:18] And how long till reset and if I have under 36 hours and over 60 percent usage left
[01:06:24] It just does it picks up these tasks automatically and just does them and to end in in its own sandbox
[01:06:32] You can see it does work trees
[01:06:34] How do you have it?
[01:06:37] How do you have a check usage?
[01:06:39] because I I had trouble
[01:06:42] getting my
[01:06:45] Getting my claw to check those percentages
[01:06:49] I'll ask for you to double check, but I believe it's in the status line
[01:06:54] But you can read the status line
[01:07:00] Yeah, I can read like the status line is where a lot of like good data comes from
[01:07:06] And it can check from the status line a lot of this data, but I'll just make sure that
[01:07:12] Because I built this like a couple weeks ago. So I I could have forgotten what we actually decided on
[01:07:21] But I remember it is accessible like the data
[01:07:24] Where are we I was like I was fighting like Claude over it like you're fighting her black. That's hilarious
[01:07:31] Oh, yeah, I've seen the same thing where like Claude will say like I can't they don't have access to that
[01:07:36] You have to go check the
[01:07:39] I need a administration administrator token. I was like, I gave you all the access
[01:07:46] No, it's it's status line at least
[01:07:50] I
[01:07:52] Reading is only as fresh as the last time a Claude code session drew its status line. So and in codex
[01:07:58] I think it was it's I remember struggling with this actually
[01:08:04] Okay, yeah, so basically in codex
[01:08:09] There's just some sort of variable
[01:08:11] Event and in Claude code
[01:08:14] There is status line
[01:08:17] great
[01:08:19] Thanks. Yeah, you bet
[01:08:22] And yeah, so if you want to take a screenshot you could probably just inject this
[01:08:29] But yeah, I mean, it's kind of a cool idea
[01:08:35] Because it's fully a self-licking ice cream cone
[01:08:38] Which means like all I have to do is just do my normal work and sometimes answer some questions
[01:08:44] And not only do I get kind of really tailored nice suggestions?
[01:08:49] Which by the way fyi you're never gonna get a one-size-fits-all system that can do this like that's it literally impossible
[01:08:58] You have to have a system that you built yourself. That's tailored to your needs and what good looks like
[01:09:05] It's never gonna just kind of spawn that in for you
[01:09:09] And then of course like instead of me running out of usage. It just does the work for me
[01:09:16] In those cases where it identifies that so
[01:09:22] I'll get you guys the templates to this or at least the
[01:09:25] The specs to this in the command center just as a little a little gift
[01:09:31] Once I have this finished and once I've used it for a couple days
[01:09:35] Because I think it's important that it actually becomes or is something that I use consistently for a long time
[01:09:43] Like I did the command center and like I do the command center for then me to give it to you
[01:09:47] But if you want to build this on your own now
[01:09:50] Just take this lecture and you can probably give the lecture to Claude and he'll
[01:09:55] understand
[01:10:00] questions thoughts
[01:10:02] Anything else you want to see?
[01:10:04] How do I give a lecture to Claude like this?
[01:10:08] And I can link to like you send the links to the videos
[01:10:13] But I don't know how to like pass that to Claude
[01:10:17] Pro tip all you got to do is go
[01:10:21] Here
[01:10:23] You're gonna click. Let's say this recording
[01:10:28] After this boom, you know open up Claude you're gonna say
[01:10:35] Extract this video as mp4 on my computer and use
[01:10:42] You know for you you might have a external dictation tool or transcription tool or your own for me
[01:10:47] I have such to patient tool
[01:10:51] to grab
[01:10:55] And it works like that it's almost like magic nowadays
[01:10:58] I remember this didn't used to work, but it works extremely well now
[01:11:02] So yeah, just give it this tell it to use browser control and it'll work
[01:11:10] That's me. So pretty much can do that for any answer
[01:11:17] Pretty much. Yeah, any video
[01:11:20] whatsoever
[01:11:21] Claude Claude is has figured out a way to find it in the exposed
[01:11:27] user interface stuff because it just goes through your browser and
[01:11:31] Another pro tip is that Claude in Chrome is logged into your browser
[01:11:36] So sometimes if you use an unlogged in playwright, this wouldn't work
[01:11:40] But Claude in Chrome is the same as a user so it is exposed the same stuff a user can see
[01:11:48] Which also means you can do automations that won't get you banned
[01:11:53] like my LinkedIn automation I
[01:11:56] Run
[01:11:58] 24-7
[01:11:59] Right, so you can see it's it's always
[01:12:05] posting
[01:12:06] various posts
[01:12:09] I'm actually reading though. I'm actually reading those and
[01:12:14] I'm out some of them are really good. Yeah, they're good, right? Yeah
[01:12:20] It's funny. Yeah, I mean if you have a good enough pipeline like there are some that I delete manually because I see them
[01:12:27] And I'm like holy this missed the mark, but in general like maybe I'll show them
[01:12:34] Again, it's it's a because it takes the thing is like if it takes real inspiration than it has
[01:12:41] Real work it can look from so I was reading this one today
[01:12:44] I have Claude code it I might build in like a better hook system to like actually give more entertaining hooks
[01:12:51] But I've Claude code build five interfaces ideas at once then I picked the one I want to keep
[01:12:56] Launch sub agents
[01:12:58] They build the alternatives. I use this for interfaces and animations. I
[01:13:03] Believe it grabbed this from one of our cohort calls
[01:13:07] So just grab the way I talked about a topic
[01:13:10] It has a system to recreate my voice and then it has a obviously like a skill or a pipeline
[01:13:16] to build the visuals and
[01:13:18] obviously templates
[01:13:25] But
[01:13:27] Is there anything else any other questions on this or any other thoughts on kind of how to get an autonomous system like this that's
[01:13:36] proactive
[01:13:37] It all makes sense. I still have some gaps
[01:13:43] The biggest gap I have is like conceptually I get going into command center and setting up pipelines
[01:13:50] Running them etc. I'm starting to play with creating like
[01:13:54] extensions of the dashboard
[01:13:56] But I'm getting kind of hung up when you want to do more advanced things like I think you've called it like a mini sass
[01:14:03] kind of thing
[01:14:05] Yeah, like yeah our micro sass
[01:14:11] Yeah, yeah, it's
[01:14:13] I'm still just trying to figure out conceptually like when I have an idea
[01:14:18] hmm, I'll I spend my time
[01:14:22] Between the CLI and command center getting everything kind of orchestrated
[01:14:28] To where then it's in the right repo and I get that like you I think you run more like a mono repo thing and
[01:14:35] Maybe I need to go to that because I think part of my challenge is I've got too many repos and
[01:14:41] I'm not going on tangent. Sorry. Yes. I've got fronts that I'm thinking about now. I haven't implemented yet and
[01:14:52] So I'm excited for Friday, you know, maybe I'll leave it there. I just need to see more examples of like
[01:14:59] And things will click I think
[01:15:02] Yes, so in general like
[01:15:05] For this stuff like for example, how I beat
[01:15:08] Built this market research pipeline is I basically said I went
[01:15:15] This I went into the command center and of course I have spec maps for it
[01:15:20] So I just say boom. Here's the read me and I say I
[01:15:24] Would like to build a new feature in the command center
[01:15:30] called market research
[01:15:34] Period it should have its own page
[01:15:38] On the dashboard
[01:15:43] Here's the flow I want
[01:15:47] We have a crown job installed at 6 a.m. That states
[01:15:54] the most viral videos
[01:15:57] According to
[01:16:01] And then I'd like to give it inspiration so I can say look at my cron tab
[01:16:07] Or how I have to set up
[01:16:10] This is very important because I've seen this happen before where there are issues and you just group that out
[01:16:16] Then you say something like blah blah blah blah blah, and then I'll say implemented
[01:16:22] By a dynamic workflow
[01:16:24] And then I will see what it puts out and I will tune it
[01:16:30] Got it. That was helpful. Thank you. Very simple. Yeah for internal tool like obviously for external tools
[01:16:36] It's different, which is why I have all the things I teach but for internal tools like that specifically
[01:16:42] It's really as simple as move as fast as possible and like be very descriptive of the high level idea you want and
[01:16:53] Make sure that Claude is not bloating the idea like for example
[01:16:57] If I wanted to make a Claude skill that I use I
[01:17:01] Would very clearly ask for the skill and then I would very clearly make sure that it
[01:17:07] Builds the skill in a way that's not adding a bunch of other instructions. Yeah
[01:17:12] And that's nowadays the main thing to navigate is like over engineering because it does that
[01:17:21] but yeah, I mean I can
[01:17:23] Look at any of these and for me. This is all I needed and sometimes there are little
[01:17:30] issues I think
[01:17:33] Maybe they removed my reddit access
[01:17:36] Or maybe not ought to look
[01:17:39] I'm also considering like a
[01:17:42] Global slash goal agent that's running 24 7 and is is a or a global Ralph loop with a slash goal
[01:17:50] That's just looking for little issues like this in my command center and patching them minimally
[01:17:55] Like I think you could do that
[01:17:58] And it wouldn't be hard
[01:18:00] So it would just grep or rejects the word failed
[01:18:07] And then it would expand around that and then it would be oh look reddit pipeline failed
[01:18:11] Here's why and then it would put in my needs review like an overview of why that happened. No reason you couldn't
[01:18:22] Let's see what this came up with that's what this built
[01:18:34] Okay
[01:18:35] so I
[01:18:37] Think I am going to jump off so that I can have more time to prepare
[01:18:45] for
[01:18:46] Friday's lecture where I will
[01:18:49] Have something like this for each one of you your homework each one of you
[01:18:54] Hopefully you can make it to the call on Friday. Otherwise DM me
[01:18:59] But your homework is to to build these files and
[01:19:02] So just to make it very very clear what you need to do and you can give this transcript to Claude once again is
[01:19:10] Open up two files
[01:19:13] The first you're gonna write manually
[01:19:16] Which is basically your north star of what the thing actually is right what it is
[01:19:22] Kind of the north star behind what you want
[01:19:25] If you have any examples of what good looks like on your computer, so oops click the wrong thing
[01:19:31] So for my videos, I have like three reference decks that I really like
[01:19:37] Right and these three reference decks serve as few shot inspiration
[01:19:42] And you can see how this is different from maybe like my business strategy front or something else
[01:19:50] So then you're gonna have it also create
[01:19:54] Or you guys won't have it create this yet
[01:19:57] I'll have it do an automation in your systems to create that
[01:20:06] Yeah, and the other thing is just identifying like what
[01:20:10] possible tasks it could do sometimes can be valuable and
[01:20:14] because for example my
[01:20:19] Pipeline for a production level application like this software engineer pipeline
[01:20:25] What work it does will be different from my videos
[01:20:30] Right my videos. I have a once a week video
[01:20:33] I would like and so that's very different from you know, what's next in my code base or again as an example for Daniel
[01:20:42] Daniel's full-time job part of it is taking tickets and doing the tickets
[01:20:46] So building his own autonomous system to do those tickets instead of just reusing this template
[01:20:53] may be better for that and
[01:20:55] Then he just gets an alert if the ticket is wrong or like if something went wrong in the ticket. So yeah actionable stuff
[01:21:07] Make
[01:21:08] Split down your day-to-day everything you do in your day-to-day that you want tracked
[01:21:14] into these pipelines and
[01:21:16] then
[01:21:18] write these manually and
[01:21:21] Then come to the call Friday
[01:21:28] Well, any any closing questions. No, thank you so much. All right guys. Thank you. Thank you everyone
[01:21:40] Have a good rest of your day
