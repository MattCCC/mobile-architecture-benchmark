// Accessibility-hierarchy dump that does not wait for an idle UI (`uiautomator dump` gives up while a screen updates
// continuously, e.g. a live Insights island). Writes the same XML shape as `uiautomator dump` (the attributes the
// acceptance driver reads). Run from the shell the way `uiautomator` itself runs:
//   CLASSPATH=/data/local/tmp/mbdump.jar app_process / MbDump /data/local/tmp/mb-ui.xml
// Built and pushed by tools/acceptance/android.mjs.
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.HandlerThread;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

public final class MbDump {
    public static void main(String[] args) throws Exception {
        // AccessibilityInteractionClient needs a main looper, as in the uiautomator command.
        android.os.Looper.prepareMainLooper();
        HandlerThread thread = new HandlerThread("MbDump");
        thread.start();
        Class<?> connectionClass = Class.forName("android.app.UiAutomationConnection");
        Object connection = connectionClass.getConstructor().newInstance();
        UiAutomation automation = UiAutomation.class
            .getConstructor(android.os.Looper.class, Class.forName("android.app.IUiAutomationConnection"))
            .newInstance(thread.getLooper(), connection);
        UiAutomation.class.getMethod("connect").invoke(automation);
        try {
            AccessibilityNodeInfo root = null;
            for (int attempt = 0; attempt < 20 && root == null; attempt++) {
                root = automation.getRootInActiveWindow();
                if (root == null) Thread.sleep(100);
            }
            if (root == null) throw new IllegalStateException("no active window");
            try (Writer out = new OutputStreamWriter(new FileOutputStream(args[0]), StandardCharsets.UTF_8)) {
                out.write("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">");
                write(out, root, 0);
                out.write("</hierarchy>");
            }
        } finally {
            UiAutomation.class.getMethod("disconnect").invoke(automation);
            thread.quit();
        }
    }

    private static void write(Writer out, AccessibilityNodeInfo node, int index) throws Exception {
        Rect r = new Rect();
        node.getBoundsInScreen(r);
        out.write("<node index=\"" + index + "\" text=\"" + esc(node.getText()) + "\" resource-id=\""
            + esc(node.getViewIdResourceName()) + "\" class=\"" + esc(node.getClassName()) + "\" content-desc=\""
            + esc(node.getContentDescription()) + "\" checkable=\"" + node.isCheckable() + "\" checked=\""
            + node.isChecked() + "\" clickable=\"" + node.isClickable() + "\" bounds=\"[" + r.left + "," + r.top
            + "][" + r.right + "," + r.bottom + "]\">");
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null && child.isVisibleToUser()) write(out, child, i);
        }
        out.write("</node>");
    }

    private static String esc(CharSequence s) {
        if (s == null) return "";
        return s.toString().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
            .replace("\n", "&#10;");
    }
}
