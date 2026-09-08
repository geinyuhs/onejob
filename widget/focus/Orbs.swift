import AppKit

// Dedicated native panels. They do not expose a JavaScript bridge or inspect other apps.
final class JobOrbButton: NSButton {
    override var isFlipped: Bool { false }
    var number = 1
    var selected = false
    override func draw(_ dirtyRect: NSRect) {
        let circle = NSRect(x: 10, y: 10, width: 58, height: 58)
        let path = NSBezierPath(ovalIn: circle)
        NSGradient(colors: [NSColor(calibratedRed: 0.98, green: 0.90, blue: 0.74, alpha: 1), NSColor(calibratedRed: 0.76, green: 0.53, blue: 0.30, alpha: 1)])?.draw(in: path, angle: -75)
        if selected { NSColor(calibratedRed: 0.83, green: 0.89, blue: 0.69, alpha: 1).setStroke(); path.lineWidth = 2; path.stroke() }
        NSColor(calibratedWhite: 0.065, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 24,y: 31,width: 11,height: 17)).fill()
        NSBezierPath(ovalIn: NSRect(x: 44,y: 31,width: 11,height: 17)).fill()
        NSColor(calibratedRed: 0.91, green: 0.85, blue: 0.67, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 54,y: 54,width: 23,height: 23)).fill()
        let label = String(number) as NSString
        label.draw(at: NSPoint(x: number < 10 ? 61 : 57,y: 57),withAttributes: [.font:NSFont.systemFont(ofSize: 13,weight: .semibold),.foregroundColor:NSColor.black])
    }
}
